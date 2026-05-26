import { api } from "./client";

export interface TradingStatus {
  ibkr: {
    state: Record<string, unknown> | null;
    trades: Array<{
      timestamp: string;
      symbol: string;
      action: "BUY" | "SELL";
      qty: number;
      estimatedValue: number;
      orderId: number;
      status: string;
      reason: string;
    }>;
  };
  binance: {
    state: Record<string, unknown> | null;
    trades: Array<{
      id: string;
      type: "BUY" | "SELL";
      symbol: string;
      qty: number;
      price: number;
      usdt: number;
      reason: string;
      timestamp: string;
    }>;
  };
}

export const tradingApi = {
  status: (companyId: string) =>
    api.get<TradingStatus>(`/companies/${companyId}/trading/status`),
};
