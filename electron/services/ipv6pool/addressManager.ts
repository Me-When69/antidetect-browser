import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAddressInPrefix64, normalizeIpv6, parsePrefix64 } from './prefix';

export const DEFAULT_MAX_ADDRESSES = 256;
export const HARD_MAX_ADDRESSES = 1024;
export const MAX_BATCH_SIZE = 64;

/**
 * Strict allowlist for Windows network interface names (e.g., "Ethernet", "Ethernet 2", "Wi-Fi", "Local Area Connection* 1").
 * Explicitly blocks all shell/PowerShell metacharacters (;, &, |, `, $, ', ", <, >, \, newlines).
 */
const SAFE_INTERFACE_NAME_RE = /^[a-zA-Z0-9 _().-]{1,128}$/;

/**
 * Strict allowlist for every netsh argument token.
 */
const SAFE_NETSH_ARG_RE = /^[a-zA-Z0-9 _().:/=-]{1,160}$/;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  execNetsh(args: readonly string[]): Promise<CommandResult>;
  execElevatedNetshBatch(argLists: readonly (readonly string[])[]): Promise<{
    exitCode: number;
    error?: string;
  }>;
}

export function validateInterfaceName(interfaceName: string): string {
  const trimmed = interfaceName.trim();
  if (!trimmed || !SAFE_INTERFACE_NAME_RE.test(trimmed)) {
    throw new Error(
      `Tên card mạng (interface) chứa ký tự không hợp lệ: "${interfaceName.slice(0, 64)}"`,
    );
  }
  return trimmed;
}

export function validateNetshArgList(args: readonly string[]): void {
  if (args.length === 0) {
    throw new Error('Danh sách tham số netsh trống');
  }
  for (const arg of args) {
    if (!SAFE_NETSH_ARG_RE.test(arg)) {
      throw new Error(`Tham số netsh không hợp lệ: "${arg.slice(0, 64)}"`);
    }
  }
}

export function validateAddressBatch(
  addresses: readonly string[],
  prefix64: string,
  maxLimit = HARD_MAX_ADDRESSES,
): string[] {
  const parsedPrefix = parsePrefix64(prefix64);
  const effectiveMax = Math.min(Math.max(1, maxLimit), HARD_MAX_ADDRESSES);
  if (addresses.length === 0) {
    throw new Error('Danh sách địa chỉ IPv6 trống');
  }
  if (addresses.length > effectiveMax) {
    throw new Error(
      `Số lượng địa chỉ (${addresses.length}) vượt quá giới hạn cho phép (${effectiveMax})`,
    );
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of addresses) {
    const norm = normalizeIpv6(raw);
    if (!isAddressInPrefix64(norm, parsedPrefix.canonical)) {
      throw new Error(
        `Địa chỉ IPv6 ${norm} không thuộc tiền tố đã xác thực ${parsedPrefix.canonical}`,
      );
    }
    if (!seen.has(norm)) {
      seen.add(norm);
      normalized.push(norm);
    }
  }
  return normalized;
}

export function buildAddAddressArgs(interfaceName: string, address: string): string[] {
  const safeIface = validateInterfaceName(interfaceName);
  const norm = normalizeIpv6(address);
  const args = [
    'interface',
    'ipv6',
    'add',
    'address',
    safeIface,
    `${norm}/64`,
    'store=active',
    'skipassource=true',
  ];
  validateNetshArgList(args);
  return args;
}

export function buildDeleteAddressArgs(interfaceName: string, address: string): string[] {
  const safeIface = validateInterfaceName(interfaceName);
  const norm = normalizeIpv6(address);
  const args = ['interface', 'ipv6', 'delete', 'address', safeIface, norm, 'store=active'];
  validateNetshArgList(args);
  return args;
}

/**
 * Parse `netsh interface ipv6 show addresses` output to extract addresses and whether
 * each is in the `Preferred` (DAD-complete) state.
 */
export function parseNetshShowAddresses(stdout: string): Map<string, { state: string }> {
  const result = new Map<string, { state: string }>();
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    // Typical English Windows output:
    // Manual    Preferred     infinite     infinite  2001:db8::1234
    const match = line.match(
      /^\s*\S+\s+(Preferred|Tentative|Duplicate|Deprecated|Invalid)\s+\S+\s+\S+\s+([0-9a-fA-F:]+(?:%[0-9]+)?)\s*$/i,
    );
    if (match) {
      const state = match[1]!.toLowerCase();
      const rawAddr = match[2]!.split('%')[0] ?? '';
      try {
        result.set(normalizeIpv6(rawAddr), { state });
      } catch {
        // Ignore non-IPv6 lines
      }
    }
  }
  return result;
}

/**
 * Real Windows CommandRunner using `execFile` (no shell interpolation) and UAC
 * elevation via `Start-Process -Verb RunAs` ONLY for add/delete batches.
 */
export class WindowsNetshCommandRunner implements CommandRunner {
  execNetsh(args: readonly string[]): Promise<CommandResult> {
    validateNetshArgList(args);
    return new Promise((resolve) => {
      execFile(
        'netsh.exe',
        [...args],
        { windowsHide: true, timeout: 15_000 },
        (err, stdout, stderr) => {
          if (err) {
            const code =
              typeof (err as { code?: unknown }).code === 'number'
                ? (err as { code: number }).code
                : 1;
            resolve({ stdout: stdout ?? '', stderr: stderr || err.message, exitCode: code });
            return;
          }
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 });
        },
      );
    });
  }

  async execElevatedNetshBatch(
    argLists: readonly (readonly string[])[],
  ): Promise<{ exitCode: number; error?: string }> {
    if (process.platform !== 'win32') {
      return {
        exitCode: 1,
        error:
          'Tính năng Kho IPv6 cục bộ hiện chỉ hỗ trợ Windows (Linux/macOS xem docs/BACKLOG.md)',
      };
    }
    if (argLists.length === 0) return { exitCode: 0 };

    // Validate EVERY single token before touching the filesystem
    const scriptLines: string[] = ['$ErrorActionPreference = "Continue"'];
    for (const args of argLists) {
      validateNetshArgList(args);
      // Every token is guaranteed to match SAFE_NETSH_ARG_RE (no quotes or special chars)
      const quoted = args.map((a) => `'${a}'`).join(' ');
      scriptLines.push(`& netsh.exe ${quoted}`);
    }

    const tmpScript = path.join(
      os.tmpdir(),
      `facet-ipv6-netsh-${crypto.randomBytes(8).toString('hex')}.ps1`,
    );
    fs.writeFileSync(tmpScript, scriptLines.join('\r\n'), 'utf8');

    try {
      return await new Promise<{ exitCode: number; error?: string }>((resolve) => {
        const psCmd =
          "$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', $env:FACET_NETSH_SCRIPT); exit $p.ExitCode";
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psCmd],
          {
            windowsHide: true,
            timeout: 120_000,
            env: { ...process.env, FACET_NETSH_SCRIPT: tmpScript },
          },
          (err, _stdout, stderr) => {
            if (err) {
              const msg = stderr?.trim() || err.message;
              const cancelled = /canceled by the user|hủy|1223/i.test(msg);
              resolve({
                exitCode: 1,
                error: cancelled
                  ? 'Người dùng đã hủy hộp thoại cấp quyền quản trị (UAC)'
                  : `Lỗi thực thi netsh với quyền quản trị: ${msg}`,
              });
              return;
            }
            resolve({ exitCode: 0 });
          },
        );
      });
    } finally {
      try {
        if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export interface AddressManagerOptions {
  dadPollIntervalMs?: number;
  dadTimeoutMs?: number;
}

export class Ipv6AddressManager {
  private runner: CommandRunner;
  private dadPollIntervalMs: number;
  private dadTimeoutMs: number;

  constructor(
    runner: CommandRunner = new WindowsNetshCommandRunner(),
    options: AddressManagerOptions = {},
  ) {
    this.runner = runner;
    this.dadPollIntervalMs = options.dadPollIntervalMs ?? 300;
    this.dadTimeoutMs = options.dadTimeoutMs ?? 10_000;
  }

  /**
   * Assign a list of validated IPv6 addresses inside `prefix64` in batches of at most 64,
   * then wait for DAD (Preferred state) before returning.
   */
  async assignAddresses(
    interfaceName: string,
    prefix64: string,
    addresses: readonly string[],
    maxLimit = DEFAULT_MAX_ADDRESSES,
  ): Promise<string[]> {
    const safeIface = validateInterfaceName(interfaceName);
    const validated = validateAddressBatch(addresses, prefix64, maxLimit);

    for (let i = 0; i < validated.length; i += MAX_BATCH_SIZE) {
      const chunk = validated.slice(i, i + MAX_BATCH_SIZE);
      const argLists = chunk.map((addr) => buildAddAddressArgs(safeIface, addr));
      const res = await this.runner.execElevatedNetshBatch(argLists);
      if (res.exitCode !== 0) {
        throw new Error(res.error ?? 'Không thể gán địa chỉ IPv6 vào card mạng');
      }
      await this.waitForDadPreferred(safeIface, chunk);
    }

    return validated;
  }

  /**
   * Remove a list of app-assigned IPv6 addresses in batches of at most 64.
   * Validates interface name and prefix membership (when prefix64 is provided).
   */
  async removeAddresses(
    interfaceName: string,
    addresses: readonly string[],
    prefix64?: string,
  ): Promise<string[]> {
    if (addresses.length === 0) return [];
    const safeIface = validateInterfaceName(interfaceName);
    const validated = prefix64
      ? validateAddressBatch(addresses, prefix64, HARD_MAX_ADDRESSES)
      : addresses.map((a) => normalizeIpv6(a));

    for (let i = 0; i < validated.length; i += MAX_BATCH_SIZE) {
      const chunk = validated.slice(i, i + MAX_BATCH_SIZE);
      const argLists = chunk.map((addr) => buildDeleteAddressArgs(safeIface, addr));
      const res = await this.runner.execElevatedNetshBatch(argLists);
      if (res.exitCode !== 0) {
        throw new Error(res.error ?? 'Không thể gỡ địa chỉ IPv6 khỏi card mạng');
      }
    }
    return validated;
  }

  async waitForDadPreferred(interfaceName: string, addresses: readonly string[]): Promise<void> {
    const safeIface = validateInterfaceName(interfaceName);
    const deadline = Date.now() + this.dadTimeoutMs;
    const targets = addresses.map((a) => normalizeIpv6(a));

    while (Date.now() <= deadline) {
      const showRes = await this.runner.execNetsh([
        'interface',
        'ipv6',
        'show',
        'addresses',
        safeIface,
      ]);
      if (showRes.exitCode === 0) {
        const parsed = parseNetshShowAddresses(showRes.stdout);
        const allPreferred = targets.every((addr) => parsed.get(addr)?.state === 'preferred');
        if (allPreferred) return;
      }
      await new Promise((r) => setTimeout(r, this.dadPollIntervalMs));
    }
  }

  /**
   * Detect orphan addresses left on the host interface from a previous app crash.
   * ONLY returns addresses present in `dbAppAssignedAddresses` — NEVER touches
   * any address that was not assigned by Facet.
   */
  async detectOrphanAddresses(
    interfaceName: string,
    dbAppAssignedAddresses: readonly string[],
  ): Promise<string[]> {
    if (dbAppAssignedAddresses.length === 0) return [];
    const safeIface = validateInterfaceName(interfaceName);
    const showRes = await this.runner.execNetsh([
      'interface',
      'ipv6',
      'show',
      'addresses',
      safeIface,
    ]);
    if (showRes.exitCode !== 0) return [];

    const onInterface = parseNetshShowAddresses(showRes.stdout);
    const orphans: string[] = [];
    for (const raw of dbAppAssignedAddresses) {
      try {
        const norm = normalizeIpv6(raw);
        if (onInterface.has(norm)) {
          orphans.push(norm);
        }
      } catch {
        // Ignore invalid DB entries
      }
    }
    return orphans;
  }
}
