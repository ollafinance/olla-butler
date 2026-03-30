/**
 * TransactionExecutor - Creates and sends on-chain transactions using a wallet client.
 * Provides methods for each automated transaction type with logging and error handling.
 */

import {
  createWalletClient,
  createPublicClient,
  getAddress,
  type Address,
  type WalletClient,
  type PublicClient,
  type Chain,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createTransport, SUPPORTED_CHAINS } from "../../core/components/transport.js";
import { OllaCoreWriteAbi, StakingManagerWriteAbi, AztecRollupWriteAbi } from "../../types/write-abis.js";
import type { ContractAddresses } from "../../types/index.js";

/**
 * Minimum gas limit for all transactions.
 * Prevents gas estimation from underestimating for functions that use hasGasLeft() checks.
 * The estimate is still used when it exceeds this floor.
 */
const GAS_FLOOR = 500_000n;

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

    const transport = createTransport(config.rpcUrl);

    this.walletClient = createWalletClient({
      account,
      chain,
      transport,
    });

    this.publicClient = createPublicClient({
      chain,
      transport,
    });

    this.addresses = config.addresses;
  }

  getExecutorAddress(): Address {
    return this.executorAddress;
  }

  /**
   * Returns the native (ETH) balance of the executor address.
   */
  async getBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.executorAddress });
  }

  /**
   * Estimates gas for a contract call and returns the greater of the estimate or GAS_FLOOR.
   */
  private async estimateGasWithFloor(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<bigint> {
    const estimate = await this.publicClient.estimateContractGas({
      account: this.account,
      ...args,
    });
    return estimate > GAS_FLOOR ? estimate : GAS_FLOOR;
  }

  /**
   * Calls OllaCore.updateAccounting()
   */
  async updateAccounting(): Promise<string> {
    const coreAddr = getAddress(this.addresses.core);
    console.log(`[TxExecutor] Sending updateAccounting() to ${coreAddr}...`);

    const gas = await this.estimateGasWithFloor({
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "updateAccounting",
      args: [],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "updateAccounting",
      args: [],
      gas,
    });
    console.log(`[TxExecutor] updateAccounting tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] updateAccounting confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`updateAccounting() reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }

  /**
   * Calls OllaCore.rebalance()
   * Rebalance is a multi-step process. Returns the tx hash for one step.
   */
  async rebalance(): Promise<string> {
    const coreAddr = getAddress(this.addresses.core);
    console.log(`[TxExecutor] Sending rebalance() to ${coreAddr}...`);

    const gas = await this.estimateGasWithFloor({
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "rebalance",
      args: [],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: coreAddr,
      abi: OllaCoreWriteAbi,
      functionName: "rebalance",
      args: [],
      gas,
    });
    console.log(`[TxExecutor] rebalance tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] rebalance confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`rebalance() reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }

  /**
   * Calls StakingManager.purgeFailedQueueEntry(address)
   * Removes an attester whose deposit failed during the rollup's entry queue flush.
   */
  async purgeFailedQueueEntry(attesterAddress: string): Promise<string> {
    const stakingAddr = getAddress(this.addresses.stakingManager);
    const addr = getAddress(attesterAddress);
    console.log(`[TxExecutor] Sending purgeFailedQueueEntry(${addr}) to ${stakingAddr}...`);

    const gas = await this.estimateGasWithFloor({
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "purgeFailedQueueEntry",
      args: [addr],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "purgeFailedQueueEntry",
      args: [addr],
      gas,
    });
    console.log(`[TxExecutor] purgeFailedQueueEntry tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] purgeFailedQueueEntry(${addr}) confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`purgeFailedQueueEntry(${addr}) reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }

  /**
   * Calls StakingManager.refreshAttesterState(address[])
   * Accepts one or more attester addresses to refresh in a single tx.
   */
  async refreshAttesters(attesterAddresses: string[]): Promise<string> {
    const stakingAddr = getAddress(this.addresses.stakingManager);
    const addrs = attesterAddresses.map((a) => getAddress(a));
    console.log(`[TxExecutor] Sending refreshAttesterState([${addrs.join(", ")}]) to ${stakingAddr}...`);

    const gas = await this.estimateGasWithFloor({
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "refreshAttesterState",
      args: [addrs],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: stakingAddr,
      abi: StakingManagerWriteAbi,
      functionName: "refreshAttesterState",
      args: [addrs],
      gas,
    });
    console.log(`[TxExecutor] refreshAttesterState tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] refreshAttesterState([${addrs.join(", ")}]) confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`refreshAttesterState([${addrs.join(", ")}]) reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }

  /**
   * Calls Rollup.flushEntryQueue() on the canonical rollup contract.
   * Processes pending attesters from the entry queue into the active set.
   */
  async flushEntryQueue(): Promise<string> {
    const rollupAddr = getAddress(this.addresses.canonicalRollup);
    console.log(`[TxExecutor] Sending flushEntryQueue() to ${rollupAddr}...`);

    const gas = await this.estimateGasWithFloor({
      address: rollupAddr,
      abi: AztecRollupWriteAbi,
      functionName: "flushEntryQueue",
      args: [],
    });

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: rollupAddr,
      abi: AztecRollupWriteAbi,
      functionName: "flushEntryQueue",
      args: [],
      gas,
    });
    console.log(`[TxExecutor] flushEntryQueue tx sent: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `[TxExecutor] flushEntryQueue confirmed in block ${receipt.blockNumber} | ` +
      `gas used: ${receipt.gasUsed} | status: ${receipt.status}`,
    );

    if (receipt.status === "reverted") {
      throw new Error(`flushEntryQueue() reverted in block ${receipt.blockNumber} (tx: ${hash})`);
    }

    return hash;
  }
}
