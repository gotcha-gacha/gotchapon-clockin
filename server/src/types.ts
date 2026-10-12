export type Tier = 'common' | 'reverse' | 'holo' | 'ultra' | 'graded';
export type Asset = 'USDC' | 'USDT';
export type PullCount = 1 | 5 | 10;
export interface Env {
  DB: D1Database;
  ENVIRONMENT: 'local' | 'preview' | 'production';
  AUTH_MODE: 'dev' | 'privy';
  PAYMENTS_MODE: 'mock' | 'solana-rpc';
  LOCAL_USER_ID?: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  PRIVY_VERIFICATION_KEY?: string;
  ADMIN_API_KEY?: string;
  ECVRF_SECRET_SEED?: string;
  SOLANA_RPC_URL: string;
  ALLOWED_ORIGINS?: string;
  ENABLED_ASSETS?: string;
  TREASURY_USDC_TOKEN_ACCOUNT: string;
  TREASURY_USDT_TOKEN_ACCOUNT?: string;
  USDC_MINT: string;
  USDT_MINT?: string;
  /** `off` skips the country block and `/me` names no country (mainnet-dev only; Ben, 11 Oct 2026). Unset or anything else
   *  blocks as at launch. */
  GEO_BLOCK?: string;
  FAUCET_ENABLED?: string;
  FAUCET_GRANT_BASE?: string;
  FEE_PAYER_ADDRESS?: string;
  FEE_PAYER_KEYPAIR?: string;
  /** House wallet that pays for a Jupiter gift. Public address. Unset until ops creates the wallet (#402). */
  HOUSE_SENDER_ADDRESS?: string;
  /** JSON array of 64 bytes, same shape as FEE_PAYER_KEYPAIR. A Wrangler secret. Never a var. */
  HOUSE_SENDER_SECRET?: string;
  /** `true` buys a gift on Claim. Anything else, including unset, leaves the album unclaimed. */
  JUPITER_GIFT_ENABLED?: string;
  TCGAPI_BASE_URL?: string;
  JUPITER_GIFT_PACK_TYPE?: string;
  JUPITER_GIFT_COUNT?: string;
  JUPITER_GACHA_OPEN_URL?: string;
  /** `magicblock` draws a new paid $1 pull's cards from MagicBlock VRF (#406); unset or `ecvrf` keeps the server proof. Read at
   *  prepare and stored on the pull, so flipping it never changes a pull already prepared. */
  DRAW_SOURCE?: string;
  /** `solana` (the deployed draw program) or `fake` (local and tests only: no chain, randomness from the sequence). */
  DRAW_CHAIN?: string;
  DRAW_PROGRAM_ID?: string;
  /** RPC for the draw program's cluster. Defaults to SOLANA_RPC_URL. */
  DRAW_RPC_URL?: string;
  /** The draw program's cluster, `devnet` or `mainnet-beta`, named in GET /pulls/:id/draw so the app can link the draw's
   *  transaction (#418). Anything else, including unset, names none and the app shows no link. */
  DRAW_CLUSTER?: string;
  /** JSON array of 64 bytes: the draw program's config authority, which pays each 0.0005 SOL request. A Wrangler secret. */
  DRAW_AUTHORITY_KEYPAIR?: string;
  /** How long one commit waits for MagicBlock before answering "still drawing" (ms). */
  DRAW_WAIT_MS?: string;
  /** How long after the request a draw may stay unfulfilled before the pull fails and its payment is owed back (ms). */
  DRAW_TIMEOUT_MS?: string;
  /** Fake chain only: `instant`, `after:N` (fulfilled on the Nth read), or `never`. */
  DRAW_FAKE?: string;
  /** `true` lets the sweep SEND refunds (#268). Anything else, including unset, still decides what is owed and sends nothing. */
  REFUNDS_ENABLED?: string;
  /** `solana` (the refund wallet on SOLANA_RPC_URL) or `fake` (local and tests only). */
  REFUND_CHAIN?: string;
  /** The refund wallet's public address, and its key (JSON array of 64 bytes, a Wrangler secret, never a var). */
  REFUND_ADDRESS?: string;
  REFUND_KEYPAIR?: string;
  /** A confirmed payment still unsettled this long after it was recorded is refunded (ms). Default 15 minutes (Ben, 7 Oct). */
  REFUND_AFTER_MS?: string;
  /** Refunds sent per sweep, and the most the sweep sends in a UTC day (base units: 1,000,000 = $1). */
  REFUND_BATCH?: string;
  REFUND_DAILY_CAP_BASE?: string;
}

export type AuthUser = { id: string; sessionId: string };

export type CardRow = {
  id: string;
  name: string;
  set_name: string;
  number: string;
  printed_rarity: string;
  image_small: string;
  image_large: string;
};

export type PullRow = {
  id: string;
  user_id: string;
  idem: string;
  sequence: number;
  gacha_id: string;
  inventory_version: number;
  album_id: string | null;
  odds_config_id: string;
  free_odds_config_id: string;
  client_seed: string;
  seed_source: 'client' | 'server';
  count: PullCount;
  targeted: number;
  asset: Asset;
  cost_base: number;
  reserved_paid: number;
  reserved_common: number;
  status: 'prepared' | 'committed' | 'expired';
  expires_at: string;
  payment_transaction_base64: string | null;
  payment_last_valid_block_height: number | null;
  tx_signature: string | null;
  vrf_public_key: string | null;
  vrf_input: string | null;
  vrf_proof: string | null;
  vrf_output: string | null;
  draw_source: 'ecvrf' | 'magicblock';
  pool_json: string | null;
  pool_hash: string | null;
  draw_account: string | null;
  draw_request_signature: string | null;
  draw_requested_at: string | null;
  draw_randomness: string | null;
  draw_failed_at: string | null;
  draw_fulfil_signature: string | null;
  resolved_at: string | null;
  response_json: string | null;
  created_at: string;
};

export type InventoryCard = CardRow & {
  inventory_key: string;
  album_id: string | null;
  tier: Tier;
  available: number;
  /** 'infinite' is album P1: not a vault count. Absent on a row read before the column existed is treated as finite. */
  supply: 'finite' | 'infinite';
  serial_counter: number;
};

export type Outcome = {
  inventoryItemId: string;
  cardId: string;
  rarity: Tier;
  serial?: string;
  isDupe: boolean;
  albumId?: string;
  card: { id: string; name: string; set: string; number: string; imgSmall: string; imgLarge: string };
};
