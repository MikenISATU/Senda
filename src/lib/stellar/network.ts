import "server-only";
import { Asset, Horizon, Networks, rpc } from "@stellar/stellar-sdk";
import { ConfigError, env } from "@/lib/server/env";

/** Circle's official TESTNET USDC issuer (Circle faucet / Paiflow docs). */
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export type AssetCode = "XLM" | "USDC";

export function network() {
  const e = env();
  const isTestnet = e.STELLAR_NETWORK === "testnet";
  const passphrase = e.STELLAR_NETWORK_PASSPHRASE || (isTestnet ? Networks.TESTNET : Networks.PUBLIC);
  if (isTestnet && passphrase !== Networks.TESTNET) throw new ConfigError(["STELLAR_NETWORK_PASSPHRASE (does not match testnet)"]);
  if (!isTestnet && passphrase !== Networks.PUBLIC) throw new ConfigError(["STELLAR_NETWORK_PASSPHRASE (does not match mainnet)"]);
  const horizonUrl = e.STELLAR_HORIZON_URL || (isTestnet ? "https://horizon-testnet.stellar.org" : undefined);
  const rpcUrl = e.STELLAR_RPC_URL || (isTestnet ? "https://soroban-testnet.stellar.org" : undefined);
  // Mainnet requires explicitly configured providers and issuer: nothing is assumed.
  if (!horizonUrl || !rpcUrl) throw new ConfigError(["STELLAR_HORIZON_URL", "STELLAR_RPC_URL"]);
  const usdcIssuer = e.STELLAR_USDC_ISSUER || (isTestnet ? TESTNET_USDC_ISSUER : undefined);
  if (!usdcIssuer) throw new ConfigError(["STELLAR_USDC_ISSUER"]);
  return {
    name: e.STELLAR_NETWORK,
    isTestnet,
    passphrase,
    horizonUrl,
    rpcUrl,
    usdcIssuer,
    explorer: isTestnet ? "https://stellar.expert/explorer/testnet" : "https://stellar.expert/explorer/public",
  };
}

export function horizon() {
  return new Horizon.Server(network().horizonUrl);
}

export function sorobanRpc() {
  const n = network();
  return new rpc.Server(n.rpcUrl, { allowHttp: n.rpcUrl.startsWith("http://localhost") });
}

export function asset(code: AssetCode): Asset {
  return code === "XLM" ? Asset.native() : new Asset("USDC", network().usdcIssuer);
}

/** Stellar Asset Contract id. Derived deterministically; env overrides must match. */
export function assetContractId(code: AssetCode): string {
  const n = network();
  const derived = asset(code).contractId(n.passphrase);
  const configured = code === "USDC" ? env().STELLAR_USDC_ASSET_CONTRACT_ID : env().STELLAR_XLM_ASSET_CONTRACT_ID;
  if (configured && configured !== derived) {
    throw new ConfigError([`${code === "USDC" ? "STELLAR_USDC_ASSET_CONTRACT_ID" : "STELLAR_XLM_ASSET_CONTRACT_ID"} (does not match ${code} on ${n.name}: expected ${derived})`]);
  }
  return derived;
}

export function txLink(hash: string) {
  return `${network().explorer}/tx/${hash}`;
}
