export interface NetworkInterfaceIpv6Info {
  name: string;
  addresses: string[];
  suggestedPrefixes: string[];
}

export interface Ipv6PoolConfig {
  interfaceName: string;
  prefix64: string;
  ownershipConfirmed: boolean;
  ownershipConfirmedAt: string | null;
  routingVerified: boolean;
  routingVerifiedAt: string | null;
  maxAddresses: number;
  maxConcurrentPerListener: number;
  echoEndpoints: string[];
  autoRotateEnabled: boolean;
  autoRotateIntervalMinutes: number;
}

export interface Ipv6RoutingCheckResult {
  ok: boolean;
  testedAddress: string;
  echoedAddress: string | null;
  endpointUsed: string | null;
  error?: string;
  guidance?: string;
}

export type Ipv6AddressHealth = 'unknown' | 'alive' | 'dead';

/**
 * Safe summary sent to Renderer via IPC.
 * NEVER includes listener proxy password!
 */
export interface Ipv6PoolEntrySummary {
  address: string;
  interfaceName: string;
  prefix64: string;
  profileId: string | null;
  profileName: string | null;
  listenPort: number | null;
  activeConnections: number;
  health: Ipv6AddressHealth;
  lastCheckedAt: string | null;
  assignedAt: string;
  isOrphan?: boolean;
}

export interface Ipv6PoolConnectionStatsEvent {
  /** Map of IPv6 address -> active connection count (batched every 200ms). */
  counts: Record<string, number>;
}

export interface Ipv6PoolStatus {
  supportedPlatform: boolean;
  config: Ipv6PoolConfig;
  entries: Ipv6PoolEntrySummary[];
  orphanAddresses: string[];
}
