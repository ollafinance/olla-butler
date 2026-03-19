/**
 * TransactionExecutor - Creates and sends on-chain transactions using a wallet client.
 * Provides methods for each automated transaction type with logging and error handling.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  getAddress,
  type Address,
  type WalletClient,
  type PublicClient,
  type Chain,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, mainnet, sepolia } from "viem/chains";
import { OllaCoreWriteAbi, StakingManagerWriteAbi } from "../../types/write-abis.js";
import type { ContractAddresses } from "../../types/index.js";

const SUPPORTED_CHAINS: Chain[] = [sepolia, mainnet, foundry];

export interface TransactionExecutorConfig {
  rpcUrl: string;
  chainId: number;
  privateKey: string;
  addresses: ContractAddresses;
}

export class TransactionExecutor {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly addresses: ContractAddresses;
  private readonly executorAddress: Address;
  private readonly chain: Chain;
  private readonly account: Account;

  constructor(config: TransactionExecutorConfig) {
    const chain = SUPPORTED_CHAINS.find((c) => c.id === config.chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }
    this.chain = chain;

    const account = privateKeyToAccount(config.privateKey as `0x${string}`);
    this.account = account;
    this.executorAddress = account.address;

    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    this.addresses = config.addresses;
  }

  getExecutorAddress(): Address {
    return this.executorAddress;
  }

  /**
   * Calls OllaCore.updateAccounting()
   */
  async updateAccounting(): Promise<string> {
    const coreAddr = getAddress(this.addresses.core);
    console.log(`[TxExecutor] Sending updateAccounting() to ${coreAddr}...`);

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "updateAccounting",
      args: [],
    });
    console.log(`[TxExecutor] updateAccounting tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] updateAccounting confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    return hash;
  }

  /**
   * Calls OllaCore.rebalance()
   * Rebalance is a multi-step process. Returns the tx hash for one step.
   */
  async rebalance(): Promise<string> {
    const coreAddr = getAddress(this.addresses.core);
    console.log(`[TxExecutor] Sending rebalance() to ${coreAddr}...`);

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "rebalance",
      args: [],
    });
    console.log(`[TxExecutor] rebalance tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] rebalance confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    return hash;
  }

  /**
   * Calls StakingManager.refreshAttester(address)
   */
  async refreshAttester(attesterAddress: string): Promise<string> {
    const stakingAddr = getAddress(this.addresses.stakingManager);
    const addr = getAddress(attesterAddress);
    console.log(`[TxExecutor] Sending refreshAttester(${addr}) to ${stakingAddr}...`);

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "refreshAttester",
      args: [addr],
    });
    console.log(`[TxExecutor] refreshAttester tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] refreshAttester(${addr}) confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    return hash;
  }
}
