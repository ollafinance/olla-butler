/**
 * Executor metrics — balance of the butler transaction executor address.
 */

import type { Attributes, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getAllNetworkStates } from "../state/index.js";

const WEI_DIVISOR = 1e18;

export const initExecutorMetrics = () => {
  const executorBalanceGauge = createObservableGauge("executor_balance_eth", {
    description: "Native (ETH) balance of the butler executor address",
  });
  executorBalanceGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.executorData) {
        result.observe(Number(state.executorData.balance) / WEI_DIVISOR, {
          network,
          address: state.executorData.address,
        });
      }
    }
  });

  const operatorBalanceGauge = createObservableGauge("operator_balance_eth", {
    description: "Native (ETH) balance of the configured public Olla operator wallet address",
  });
  operatorBalanceGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.operatorWalletData) {
        result.observe(Number(state.operatorWalletData.balance) / WEI_DIVISOR, {
          network,
          address: state.operatorWalletData.address,
        });
      }
    }
  });

  const operatorBalanceWeiGauge = createObservableGauge("operator_balance_wei", {
    description: "Native (wei) balance of the configured public Olla operator wallet address",
  });
  operatorBalanceWeiGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.operatorWalletData) {
        result.observe(Number(state.operatorWalletData.balance), {
          network,
          address: state.operatorWalletData.address,
        });
      }
    }
  });

  const operatorBalanceUpdatedGauge = createObservableGauge("operator_balance_last_updated_timestamp", {
    description: "Unix timestamp of the last successful public Olla operator wallet balance scrape",
  });
  operatorBalanceUpdatedGauge.addCallback((result: ObservableResult<Attributes>) => {
    for (const [network, state] of getAllNetworkStates().entries()) {
      if (state.operatorWalletData) {
        result.observe(state.operatorWalletData.lastUpdated.getTime() / 1000, {
          network,
          address: state.operatorWalletData.address,
        });
      }
    }
  });

  console.log("Executor metrics initialized");
};
