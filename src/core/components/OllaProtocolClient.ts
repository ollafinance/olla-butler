import {
  createPublicClient,
  getAddress,
  getContract,
  type Address,
  type GetContractReturnType,
  type PublicClient,
} from "viem";
import { foundry, mainnet, sepolia } from "viem/chains";
import { createTransport } from "./transport.js";
import {
  OllaCoreAbi,
  OllaVaultAbi,
  StakingManagerAbi,
  StakingProviderRegistryAbi,
  SafetyModuleAbi,
  WithdrawalQueueAbi,
  ERC20Abi,
  AztecRollupRegistryAbi,
  AztecRollupAbi,
  AztecAttesterStatus,
  type ContractAddresses,
  type CoreData,
  type VaultData,
  type StakingData,
  type SafetyModuleData,
  type WithdrawalQueueData,
  type RebalanceProgress,
  type AttesterState,
  RebalanceStep,
} from "../../types/index.js";

const SUPPORTED_CHAINS = [sepolia, mainnet, foundry];

type OllaCoreContract = GetContractReturnType<typeof OllaCoreAbi, PublicClient>;
type OllaVaultContract = GetContractReturnType<typeof OllaVaultAbi, PublicClient>;
type StakingManagerContract = GetContractReturnType<typeof StakingManagerAbi, PublicClient>;
type StakingProviderRegistryContract = GetContractReturnType<typeof StakingProviderRegistryAbi, PublicClient>;
type SafetyModuleContract = GetContractReturnType<typeof SafetyModuleAbi, PublicClient>;
type WithdrawalQueueContract = GetContractReturnType<typeof WithdrawalQueueAbi, PublicClient>;
type ERC20Contract = GetContractReturnType<typeof ERC20Abi, PublicClient>;
type AztecRollupRegistryContract = GetContractReturnType<typeof AztecRollupRegistryAbi, PublicClient>;
type AztecRollupContract = GetContractReturnType<typeof AztecRollupAbi, PublicClient>;

export interface OllaProtocolClientConfig {
  rpcUrl: string;
  chainId: number;
  coreAddress: Address;
}

/**
 * Client for reading Olla protocol on-chain state.
 * Discovers all satellite contract addresses from OllaCore on init.
 */
export class OllaProtocolClient {
  private readonly client: PublicClient;
  private readonly config: OllaProtocolClientConfig;

  private coreContract!: OllaCoreContract;
  private vaultContract!: OllaVaultContract;
  private stakingManagerContract!: StakingManagerContract;
  private stakingProviderRegistryContract!: StakingProviderRegistryContract;
  private safetyModuleContract!: SafetyModuleContract;
  private withdrawalQueueContract!: WithdrawalQueueContract;
  private stAztecContract!: ERC20Contract;
  private rollupRegistryContract!: AztecRollupRegistryContract;
  private canonicalRollupContract!: AztecRollupContract;

  private addresses: ContractAddresses | null = null;
  private historicalRollupContracts: AztecRollupContract[] = [];

  constructor(config: OllaProtocolClientConfig) {
    this.config = config;
    const chain = SUPPORTED_CHAINS.find((c) => c.id === config.chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }

    this.client = createPublicClient({
      transport: createTransport(config.rpcUrl),
      chain,
    });
  }

  /**
   * Initialize by discovering all contract addresses from OllaCore.
   * Must be called before using any scraping methods.
   */
  async init(): Promise<ContractAddresses> {
    console.log(`[OllaProtocolClient] Discovering contract addresses from core at ${this.config.coreAddress}...`);

    this.coreContract = getContract({
      address: this.config.coreAddress,
      abi: OllaCoreAbi,
      client: this.client,
    });

    // Discover all satellite addresses from OllaCore
    const [vaultAddr, stAztecAddr, stakingManagerAddr, rewardsAccumulatorAddr, safetyModuleAddr, assetAddr] =
      await Promise.all([
        this.coreContract.read.vault(),
        this.coreContract.read.stAztec(),
        this.coreContract.read.stakingManager(),
        this.coreContract.read.rewardsAccumulator(),
        this.coreContract.read.safetyModule(),
        this.coreContract.read.asset(),
      ]);

    // Initialize vault contract to discover withdrawal queue
    this.vaultContract = getContract({
      address: getAddress(vaultAddr),
      abi: OllaVaultAbi,
      client: this.client,
    });

    const withdrawalQueueAddr = await this.vaultContract.read.withdrawalQueue();

    // Initialize staking manager to discover provider registry
    this.stakingManagerContract = getContract({
      address: getAddress(stakingManagerAddr),
      abi: StakingManagerAbi,
      client: this.client,
    });

    const [stakingProviderRegistryAddr, rollupRegistryAddr] = await Promise.all([
      this.stakingManagerContract.read.stakingProviderRegistry(),
      this.stakingManagerContract.read.rollupRegistry(),
    ]);

    // Initialize rollup registry and discover canonical rollup
    this.rollupRegistryContract = getContract({
      address: getAddress(rollupRegistryAddr),
      abi: AztecRollupRegistryAbi,
      client: this.client,
    });

    const canonicalRollupAddr = await this.rollupRegistryContract.read.getCanonicalRollup();

    this.canonicalRollupContract = getContract({
      address: getAddress(canonicalRollupAddr),
      abi: AztecRollupAbi,
      client: this.client,
    });

    // Discover all historical rollup versions for exiting attester queries
    // Mock rollup registries may not implement numberOfVersions(), so handle gracefully
    this.historicalRollupContracts = [];
    try {
      const numVersions = await this.rollupRegistryContract.read.numberOfVersions();
      for (let i = 0n; i < numVersions; i++) {
        const version = await this.rollupRegistryContract.read.getVersion([i]);
        const rollupAddr = await this.rollupRegistryContract.read.getRollup([version]);
        const addr = getAddress(rollupAddr);
        if (addr.toLowerCase() !== getAddress(canonicalRollupAddr).toLowerCase()) {
          this.historicalRollupContracts.push(
            getContract({ address: addr, abi: AztecRollupAbi, client: this.client }),
          );
        }
      }
    } catch {
      console.warn(`[OllaProtocolClient] Could not discover historical rollup versions (mock registry?). Skipping.`);
    }

    // Initialize remaining contracts
    this.stakingProviderRegistryContract = getContract({
      address: getAddress(stakingProviderRegistryAddr),
      abi: StakingProviderRegistryAbi,
      client: this.client,
    });

    this.safetyModuleContract = getContract({
      address: getAddress(safetyModuleAddr),
      abi: SafetyModuleAbi,
      client: this.client,
    });

    this.withdrawalQueueContract = getContract({
      address: getAddress(withdrawalQueueAddr),
      abi: WithdrawalQueueAbi,
      client: this.client,
    });

    this.stAztecContract = getContract({
      address: getAddress(stAztecAddr),
      abi: ERC20Abi,
      client: this.client,
    });

    this.addresses = {
      core: this.config.coreAddress,
      vault: vaultAddr,
      stAztec: stAztecAddr,
      stakingManager: stakingManagerAddr,
      rewardsAccumulator: rewardsAccumulatorAddr,
      safetyModule: safetyModuleAddr,
      withdrawalQueue: withdrawalQueueAddr,
      stakingProviderRegistry: stakingProviderRegistryAddr,
      asset: assetAddr,
      rollupRegistry: rollupRegistryAddr,
      canonicalRollup: canonicalRollupAddr,
    };

    console.log(`[OllaProtocolClient] Contract addresses discovered:`);
    for (const [name, addr] of Object.entries(this.addresses)) {
      console.log(`  ${name}: ${addr}`);
    }

    return this.addresses;
  }

  getAddresses(): ContractAddresses {
    if (!this.addresses) {
      throw new Error("OllaProtocolClient not initialized. Call init() first.");
    }
    return this.addresses;
  }

  getPublicClient(): PublicClient {
    return this.client;
  }

  async scrapeCoreData(): Promise<CoreData> {
    const [totalAssets, exchangeRate, protocolFeeBP, treasuryFeeSplitBP, targetBufferedAssets, rebalanceCooldown, accountingState, latestReport, rebalanceProgress, flowCounters] =
      await Promise.all([
        this.coreContract.read.totalAssets(),
        this.coreContract.read.exchangeRate(),
        this.coreContract.read.protocolFeeBP(),
        this.coreContract.read.treasuryFeeSplitBP(),
        this.coreContract.read.targetBufferedAssets(),
        this.coreContract.read.rebalanceCooldown(),
        this.coreContract.read.accountingState(),
        this.coreContract.read.latestReport(),
        this.coreContract.read.rebalanceProgress(),
        this.coreContract.read.flowCounters(),
      ]);

    return {
      totalAssets,
      exchangeRate,
      protocolFeeBP,
      treasuryFeeSplitBP,
      targetBufferedAssets,
      rebalanceCooldown,
      accountingState: {
        stakedPrincipal: accountingState.stakedPrincipal,
        rewardsAccumulatorBalance: accountingState.rewardsAccumulatorBalance,
        claimableRewards: accountingState.claimableRewards,
        rewardsDelta: accountingState.rewardsDelta,
        slashingDelta: accountingState.slashingDelta,
        cumulativeRewards: accountingState.cumulativeRewards,
      },
      latestReport: {
        totalAssets: latestReport.totalAssets,
        exchangeRate: latestReport.exchangeRate,
        grossRewards: latestReport.grossRewards,
        netFlows: latestReport.netFlows,
        rewardsSnapshot: latestReport.rewardsSnapshot,
        timestamp: latestReport.timestamp,
      },
      rebalanceProgress: {
        step: rebalanceProgress.step as RebalanceStep,
        stakeRemaining: rebalanceProgress.stakeRemaining,
        unstakeRemaining: rebalanceProgress.unstakeRemaining,
      },
      flowCounters: {
        cumulativeDeposits: flowCounters.cumulativeDeposits,
        cumulativeWithdrawals: flowCounters.cumulativeWithdrawals,
        latestReportCumulativeDeposits: flowCounters.latestReportCumulativeDeposits,
        latestReportCumulativeWithdrawals: flowCounters.latestReportCumulativeWithdrawals,
      },
      lastUpdated: new Date(),
    };
  }

  async scrapeVaultData(): Promise<VaultData> {
    const [bufferedAssets, pendingWithdrawalAssets, pendingWithdrawalShares, cumulativeDeposits, cumulativeWithdrawals, totalAssets, instantRedemptionFeeBP, availableForInstantRedemption, stAztecTotalSupply] =
      await Promise.all([
        this.vaultContract.read.bufferedAssets(),
        this.vaultContract.read.pendingWithdrawalAssets(),
        this.vaultContract.read.pendingWithdrawalShares(),
        this.vaultContract.read.cumulativeDeposits(),
        this.vaultContract.read.cumulativeWithdrawals(),
        this.vaultContract.read.totalAssets(),
        this.vaultContract.read.instantRedemptionFeeBP(),
        this.vaultContract.read.availableForInstantRedemption(),
        this.stAztecContract.read.totalSupply(),
      ]);

    return {
      bufferedAssets,
      pendingWithdrawalAssets,
      pendingWithdrawalShares,
      cumulativeDeposits,
      cumulativeWithdrawals,
      totalAssets,
      instantRedemptionFeeBP,
      availableForInstantRedemption,
      stAztecTotalSupply,
      lastUpdated: new Date(),
    };
  }

  async scrapeStakingData(): Promise<StakingData> {
    const [totalStaked, pendingUnstakes, activatedAttesterCount, pendingUnstakeCount, hasExitableUnstakes, stakingState, providerConfig, keyQueueLength] =
      await Promise.all([
        this.stakingManagerContract.read.totalStaked(),
        this.stakingManagerContract.read.pendingUnstakes(),
        this.stakingManagerContract.read.getActivatedAttesterCount(),
        this.stakingManagerContract.read.getPendingUnstakeCount(),
        this.stakingManagerContract.read.hasExitableUnstakes(),
        this.stakingManagerContract.read.getStakingState(),
        this.stakingManagerContract.read.getProviderConfig(),
        this.stakingProviderRegistryContract.read.getQueueLength(),
      ]);

    return {
      totalStaked,
      pendingUnstakes,
      activatedAttesterCount,
      pendingUnstakeCount,
      hasExitableUnstakes,
      stakingState: {
        slashingDelta: stakingState.slashingDelta,
        stakedAmount: stakingState.stakedAmount,
        pendingUnstakeAmount: stakingState.pendingUnstakeAmount,
      },
      providerConfig: {
        admin: providerConfig.admin,
        rewardsRecipient: providerConfig.rewardsRecipient,
      },
      keyQueueLength,
      lastUpdated: new Date(),
    };
  }

  async scrapeSafetyModuleData(): Promise<SafetyModuleData> {
    const [isPaused, depositCap] = await Promise.all([
      this.safetyModuleContract.read.isPaused(),
      this.safetyModuleContract.read.depositCap(),
    ]);

    return {
      isPaused,
      depositCap,
      lastUpdated: new Date(),
    };
  }

  async scrapeWithdrawalQueueData(): Promise<WithdrawalQueueData> {
    const [nextRequestId, nextPendingId, totalPendingAssets, totalPendingShares, nextUnfinalized] =
      await Promise.all([
        this.withdrawalQueueContract.read.nextRequestId(),
        this.withdrawalQueueContract.read.nextPendingId(),
        this.withdrawalQueueContract.read.totalPendingAssets(),
        this.withdrawalQueueContract.read.totalPendingShares(),
        this.withdrawalQueueContract.read.nextUnfinalized(),
      ]);

    return {
      nextRequestId: BigInt(nextRequestId),
      nextPendingId: BigInt(nextPendingId),
      totalPendingAssets,
      totalPendingShares,
      nextUnfinalized,
      lastUpdated: new Date(),
    };
  }

  async scrapeActivationThreshold(): Promise<bigint> {
    return this.canonicalRollupContract.read.getActivationThreshold();
  }

  /**
   * Queries the Aztec rollup for attester state.
   * Tries the canonical rollup first; for attesters showing NONE status,
   * falls back to historical rollup versions (for exiting attesters on old rollups).
   */
  async scrapeAttesterStates(attesterAddresses: string[]): Promise<AttesterState[]> {
    const now = BigInt(Math.floor(Date.now() / 1000));

    const results = await Promise.all(
      attesterAddresses.map(async (addr): Promise<AttesterState> => {
        const address = getAddress(addr) as Address;
        let view = await this.canonicalRollupContract.read.getAttesterView([address]);

        // If NONE on canonical, try historical rollups (attester may be exiting on old rollup)
        if (view.status === AztecAttesterStatus.NONE && this.historicalRollupContracts.length > 0) {
          for (const historicalRollup of this.historicalRollupContracts) {
            const historicalView = await historicalRollup.read.getAttesterView([address]);
            if (historicalView.status !== AztecAttesterStatus.NONE) {
              view = historicalView;
              break;
            }
          }
        }

        return {
          address: addr.toLowerCase(),
          status: view.status as AztecAttesterStatus,
          effectiveBalance: view.effectiveBalance,
          exit: {
            exists: view.exit.exists,
            amount: view.exit.amount,
            exitableAt: view.exit.exitableAt,
            isExitable: view.exit.exists && view.exit.exitableAt <= now,
          },
        };
      }),
    );

    return results;
  }

  /**
   * Refreshes the canonical rollup address from the registry.
   * Should be called periodically to handle rollup upgrades.
   */
  async refreshCanonicalRollup(): Promise<void> {
    const canonicalRollupAddr = await this.rollupRegistryContract.read.getCanonicalRollup();
    const newAddr = getAddress(canonicalRollupAddr);

    if (this.addresses && newAddr.toLowerCase() !== this.addresses.canonicalRollup.toLowerCase()) {
      console.log(
        `[OllaProtocolClient] Canonical rollup changed: ${this.addresses.canonicalRollup} → ${newAddr}`,
      );
      this.addresses.canonicalRollup = newAddr;
      this.canonicalRollupContract = getContract({
        address: newAddr,
        abi: AztecRollupAbi,
        client: this.client,
      });
    }
  }
}
