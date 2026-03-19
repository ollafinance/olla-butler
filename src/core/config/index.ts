import dotenv from "dotenv";
import envPaths from "env-paths";
import fs from "fs/promises";
import path from "node:path";
import z from "zod";

const packageVersion =
  process.env.npm_package_version || process.env.NPM_PACKAGE_VERSION || "0.0.1";
const packageName =
  process.env.npm_package_name || process.env.NPM_PACKAGE_NAME || "olla-butler";

const SENSITIVE_CONFIG_KEYS = new Set([
  "METRICS_BEARER_TOKEN",
  "BUTLER_PRIVATE_KEY",
]);

export const PACKAGE_VERSION = packageVersion;
export const PACKAGE_NAME = packageName;

const getConfigDir = (): string => {
  return envPaths(PACKAGE_NAME, { suffix: "" }).config;
};

export const getDataDir = (): string => {
  return envPaths(PACKAGE_NAME, { suffix: "" }).data;
};

async function findNetworkConfigs(): Promise<string[]> {
  try {
    const configDir = getConfigDir();
    const files = await fs.readdir(configDir);
    return files
      .filter((f) => f.endsWith("-base.env"))
      .map((f) => f.replace("-base.env", ""));
  } catch {
    return [];
  }
}

function parseConfigField<T>(
  fieldName: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.message}`)
      .join("\n");
    throw new Error(
      `Invalid configuration for ${fieldName}:\n${errors}\n  Received: ${typeof value === "string" && value.length > 50 ? value.slice(0, 50) + "..." : value}`,
    );
  }
  return result.data;
}

function buildConfig(network: string) {
  return {
    NETWORK: parseConfigField("NETWORK", z.string(), network),
    ETHEREUM_CHAIN_ID: parseConfigField(
      "ETHEREUM_CHAIN_ID",
      z.coerce.number().int(),
      process.env.ETHEREUM_CHAIN_ID,
    ),
    ETHEREUM_NODE_URL: parseConfigField(
      "ETHEREUM_NODE_URL",
      z.string(),
      process.env.ETHEREUM_NODE_URL || "http://localhost:8545",
    ),
    OLLA_CORE_ADDRESS: parseConfigField(
      "OLLA_CORE_ADDRESS",
      z.string().startsWith("0x").length(42),
      process.env.OLLA_CORE_ADDRESS,
    ),
    METRICS_BEARER_TOKEN: parseConfigField(
      "METRICS_BEARER_TOKEN",
      z.string().optional(),
      process.env.METRICS_BEARER_TOKEN,
    ),
    METRICS_PORT: parseConfigField(
      "METRICS_PORT",
      z.coerce.number().int().positive(),
      process.env.METRICS_PORT || "9470",
    ),
    ATTESTER_SCAN_START_BLOCK: parseConfigField(
      "ATTESTER_SCAN_START_BLOCK",
      z.coerce.number().int().nonnegative().optional(),
      process.env.ATTESTER_SCAN_START_BLOCK || undefined,
    ),
    TX_EXECUTOR_ENABLED: parseConfigField(
      "TX_EXECUTOR_ENABLED",
      z.enum(["true", "false"]).transform((v) => v === "true").optional(),
      process.env.TX_EXECUTOR_ENABLED || undefined,
    ),
    BUTLER_PRIVATE_KEY: parseConfigField(
      "BUTLER_PRIVATE_KEY",
      z.string().startsWith("0x").optional(),
      process.env.BUTLER_PRIVATE_KEY || undefined,
    ),
  };
}

export type ButlerConfig = ReturnType<typeof buildConfig>;

async function loadNetworkConfig(
  network: string,
  suppressLog?: boolean,
  userConfigFilePath?: string,
): Promise<ButlerConfig> {
  const configPath =
    userConfigFilePath || path.join(getConfigDir(), `${network}-base.env`);
  // Use override: true to prevent env vars from a previously loaded network
  // leaking into subsequent networks (dotenv does not overwrite existing vars by default)
  dotenv.config({ path: configPath, override: true });

  const config = buildConfig(network);
  await ensureConfigFile(configPath, !!userConfigFilePath, config);

  if (!suppressLog) {
    console.log(`CONFIGURATION (reading from ${configPath}):
${Object.entries(config)
  .map(
    ([key, value]) =>
      `  ${key}\t${SENSITIVE_CONFIG_KEYS.has(key) ? "[redacted]" : value}`,
  )
  .join("\n")}
`);
  }
  return config;
}

export const initConfig = async (options?: {
  suppressLog?: boolean;
  userConfigFilePath?: string;
  network?: string;
}): Promise<ButlerConfig> => {
  console.log("\n\nInitializing configuration...\n\n");

  const availableNetworks = await findNetworkConfigs();

  let selectedNetwork: string;
  if (options?.network) {
    selectedNetwork = options.network;
  } else if (options?.userConfigFilePath) {
    const fileName = path.basename(options.userConfigFilePath);
    const match = fileName.match(/^(.+)-base\.env$/);
    selectedNetwork = match?.[1] ?? "unknown";
  } else if (availableNetworks.length === 1) {
    selectedNetwork = availableNetworks[0]!;
    console.log(`Using network: ${selectedNetwork}`);
  } else if (availableNetworks.length === 0) {
    console.warn(
      "No network configurations found. Creating default testnet config.",
    );
    selectedNetwork = "testnet";
  } else {
    throw new Error(
      "Multiple network configs found. Please specify --network flag.\n" +
        `Available: ${availableNetworks.join(", ")}`,
    );
  }

  return await loadNetworkConfig(
    selectedNetwork,
    options?.suppressLog,
    options?.userConfigFilePath,
  );
};

export const loadAllAvailableNetworkConfigs = async (options?: {
  suppressLog?: boolean;
  specificNetwork?: string;
}): Promise<Map<string, ButlerConfig>> => {
  const configs = new Map<string, ButlerConfig>();

  if (options?.specificNetwork) {
    console.log(
      `[Config] Loading specific network: ${options.specificNetwork}`,
    );
    const config = await loadNetworkConfig(
      options.specificNetwork,
      options?.suppressLog,
    );
    configs.set(options.specificNetwork, config);
    return configs;
  }

  const availableNetworks = await findNetworkConfigs();

  if (availableNetworks.length === 0) {
    console.warn(
      "No network configurations found. Please create network configs.",
    );
    return configs;
  }

  console.log(
    `[Config] Loading all available networks: ${availableNetworks.join(", ")}`,
  );

  for (const network of availableNetworks) {
    try {
      const config = await loadNetworkConfig(network, options?.suppressLog);
      configs.set(network, config);
      console.log(`  Loaded config for network: ${network}`);
    } catch (error) {
      console.error(`  Failed to load config for network ${network}:`, error);
    }
  }

  console.log(`[Config] Total configs loaded: ${configs.size}`);
  return configs;
};

const ensureConfigFile = async (
  configFilePath: string,
  isUserDefined: boolean,
  conf: ButlerConfig,
) => {
  const configFormattedString = Object.entries(conf).map(
    ([key, value]) => (value ? `${key}=${value}` : `# ${key}=`) + "\n",
  );
  try {
    await fs.stat(configFilePath);
  } catch {
    if (isUserDefined) {
      throw new Error(
        `Config file not found at provided path: ${configFilePath}`,
      );
    }

    console.log(
      `\nNo config found. Creating default config at\n   ${configFilePath}\n`,
    );

    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.writeFile(configFilePath, configFormattedString.join(""));
  }
};
