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

  console.log("Executor metrics initialized");
};
