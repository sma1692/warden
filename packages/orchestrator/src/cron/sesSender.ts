/**
 * AWS SES Branded HTML Email Sender & Nightly Analytics Email Templating.
 *
 * Implements Amazon Simple Email Service (SES) email dispatch for Warden Automatons
 * executive briefings and analytics reports, with dynamic SDK loading, SMTP fallback,
 * and dry-run preview capabilities.
 *
 * Env vars:
 * - AWS_REGION or AWS_DEFAULT_REGION (default: us-east-1)
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 * - SES_FROM_EMAIL or SMTP_FROM (default: Warden Automatons <owner@warden.autos>)
 * - OWNER_EMAIL or ANALYTICS_RECIPIENT_EMAIL
 */
import {
  buildMimePayload,
  getWardenLogoPngBuffer,
  sendEmailMessage,
  WARDEN_SURFACE_B,
} from '../auth/EmailSender.js';
import type { Ga4TrafficSummary } from '../analytics/ga4.js';

export { WARDEN_SURFACE_B, getWardenLogoPngBuffer, buildMimePayload };

export interface NightlyAnalyticsMetrics {
  date: string;
  generatedAtIst: string;
  users: {
    totalRegistered: number;
    dau: number;
    wau: number;
    mau: number;
    newSignupsToday: number;
    retentionD1Percent: number;
    retentionD7Percent: number;
  };
  conversations: {
    activeThreads: number;
    totalPromptsToday: number;
    avgPromptsPerUser: number;
    avgResponseLatencyMs: number;
    topDepartments: Array<{ department: string; count: number }>;
  };
  agents: {
    totalAgents: number;
    activeToday: number;
    totalRuns: number;
    successRatePercent: number;
    terminatedOrFailed: number;
    hierarchyDistribution: {
      level0Cxo: number;
      level1Leads: number;
      level2Devs: number;
    };
  };
  tokenSpend: {
    tokensIn: number;
    tokensOut: number;
    tokensCached: number;
    tokensThinking: number;
    costUsdToday: number;
    monthlyBudgetUsd: number;
    budgetUsedPercent: number;
    byProvider: Array<{ provider: string; costUsd: number; tokens: number }>;
  };
  ga4Traffic: {
    activeUsers: number;
    sessions: number;
    pageViews: number;
    avgEngagementDurationSec: number;
    bounceRatePercent: number;
    topSources: Array<{ source: string; percentage: number }>;
  };
  infraHealth: {
    postgresStatus: 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED';
    activeDbConnections: number;
    activeWebSockets: number;
    p95LatencyMs: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
    sandboxContainersActive: number;
    uptimeHours: number;
  };
}

export interface SesSendOptions {
  from?: string;
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  dryRun?: boolean;
}

export interface SesSendResult {
  ok: boolean;
  messageId?: string;
  dryRun?: boolean;
  transport?: 'ses_v3' | 'ses_v2' | 'smtp' | 'console_preview';
  error?: string;
}

/**
 * Attempts to load AWS SDK v3 (@aws-sdk/client-ses) or v2 (aws-sdk).
 */
async function loadAwsSes(): Promise<{
  type: 'v3' | 'v2' | 'none';
  client?: any;
  SendEmailCommand?: any;
  SendRawEmailCommand?: any;
}> {
  try {
    const v3Pkg = '@aws-sdk/client-ses';
    const v3Mod: any = await import(/* @vite-ignore */ v3Pkg);
    if (v3Mod?.SESClient) {
      const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
      const client = new v3Mod.SESClient({ region });
      return {
        type: 'v3',
        client,
        SendEmailCommand: v3Mod.SendEmailCommand,
        SendRawEmailCommand: v3Mod.SendRawEmailCommand,
      };
    }
  } catch {
    // V3 not installed
  }

  try {
    const v2Pkg = 'aws-sdk';
    const v2Mod: any = await import(/* @vite-ignore */ v2Pkg);
    const AWS = v2Mod?.default || v2Mod;
    if (AWS?.SES) {
      const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
      const client = new AWS.SES({ region });
      return { type: 'v2', client };
    }
  } catch {
    // V2 not installed
  }

  return { type: 'none' };
}

/**
 * Sends an email using AWS SES (with multipart/related MIME and inline cid:warden-logo),
 * falling back to built-in SMTP or console preview.
 */
export async function sendSesEmail(options: SesSendOptions): Promise<SesSendResult> {
  const from =
    options.from ||
    process.env.SES_FROM_EMAIL ||
    process.env.SMTP_FROM ||
    'Warden Automatons <owner@warden.autos>';
  const recipients = Array.isArray(options.to) ? options.to : [options.to];

  if (options.dryRun) {
    console.log(`[SES Dry Run] Email preview ready for: ${recipients.join(', ')}`);
    console.log(`[SES Dry Run] Subject: ${options.subject}`);
    console.log(`[SES Dry Run] Payload length: ${options.htmlBody.length} bytes`);
    return { ok: true, dryRun: true, transport: 'console_preview', messageId: `dry_run_${Date.now()}` };
  }

  const plainText =
    options.textBody ||
    `Warden Automatons Nightly Executive Brief for ${new Date().toISOString().slice(0, 10)}. Please view in an HTML-compatible client.`;

  // Build multipart/related MIME with cid:warden-logo attachment
  const rawMime = buildMimePayload(
    {
      headerFrom: from,
      to: recipients.join(', '),
      subject: options.subject,
      bodyText: plainText,
      bodyHtml: options.htmlBody,
    },
    { dotStuff: false }
  );

  const ses = await loadAwsSes();

  if (ses.type === 'v3' && ses.client) {
    // Try raw MIME first to preserve multipart/related inline cid:warden-logo
    if (ses.SendRawEmailCommand) {
      try {
        const rawCmd = new ses.SendRawEmailCommand({
          RawMessage: {
            Data: Buffer.from(rawMime, 'utf8'),
          },
        });
        const response = await ses.client.send(rawCmd);
        return {
          ok: true,
          messageId: response.MessageId,
          transport: 'ses_v3',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[SES v3 Warning] SendRawEmailCommand failed (${msg}). Trying SendEmailCommand fallback...`);
      }
    }

    if (ses.SendEmailCommand) {
      try {
        const command = new ses.SendEmailCommand({
          Source: from,
          Destination: {
            ToAddresses: recipients,
          },
          Message: {
            Subject: {
              Data: options.subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: options.htmlBody,
                Charset: 'UTF-8',
              },
              Text: {
                Data: plainText,
                Charset: 'UTF-8',
              },
            },
          },
        });

        const response = await ses.client.send(command);
        return {
          ok: true,
          messageId: response.MessageId,
          transport: 'ses_v3',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[SES v3 Error] Failed to send via SES SDK v3: ${msg}. Trying SMTP fallback...`);
      }
    }
  } else if (ses.type === 'v2' && ses.client) {
    if (typeof ses.client.sendRawEmail === 'function') {
      try {
        const rawParams = {
          RawMessage: {
            Data: Buffer.from(rawMime, 'utf8'),
          },
        };
        const result = await new Promise<{ MessageId?: string }>((resolve, reject) => {
          ses.client.sendRawEmail(rawParams, (err: any, data: any) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        return {
          ok: true,
          messageId: result.MessageId,
          transport: 'ses_v2',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[SES v2 Warning] sendRawEmail failed (${msg}). Trying sendEmail fallback...`);
      }
    }

    try {
      const params = {
        Source: from,
        Destination: {
          ToAddresses: recipients,
        },
        Message: {
          Subject: {
            Data: options.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: options.htmlBody,
              Charset: 'UTF-8',
            },
            Text: {
              Data: plainText,
              Charset: 'UTF-8',
            },
          },
        },
      };

      const result = await new Promise<{ MessageId?: string }>((resolve, reject) => {
        ses.client.sendEmail(params, (err: any, data: any) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      return {
        ok: true,
        messageId: result.MessageId,
        transport: 'ses_v2',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SES v2 Error] Failed to send via SES SDK v2: ${msg}. Trying SMTP fallback...`);
    }
  }

  // Fallback: built-in SMTP sender via EmailSender.ts (with htmlOverride)
  for (const recipient of recipients) {
    const smtpRes = await sendEmailMessage(recipient, options.subject, plainText, {
      htmlOverride: options.htmlBody,
    });
    if (!smtpRes.ok) {
      return {
        ok: false,
        error: `SES not loaded and SMTP failed: ${smtpRes.error}`,
      };
    }
  }

  return {
    ok: true,
    transport: 'smtp',
    messageId: `smtp_${Date.now()}`,
  };
}

/**
 * Builds the branded Warden HTML email template string for the nightly analytics brief
 * using Dark Mode Surface B design system colors and inline cid:warden-logo.
 */
export function renderNightlyAnalyticsEmailHtml(metrics: NightlyAnalyticsMetrics): string {
  const appUrl = (process.env.PUBLIC_APP_URL || 'https://warden.autos').replace(/\/+$/, '');

  const formatNum = (n: number) => n.toLocaleString('en-US');
  const formatCur = (n: number) => `$${n.toFixed(2)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>Warden Automatons — Daily Executive Brief (${metrics.date})</title>
</head>
<body style="margin:0;padding:0;background-color:#0B121C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#F5F0E6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0B121C;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background-color:#0F1824;border:1px solid #1F2C3F;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.7);">
          <!-- Top Gold Gradient Header Bar -->
          <tr>
            <td style="height:5px;background:linear-gradient(90deg,#C6A664 0%,#E5CF92 50%,#C6A664 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Brand & Timestamp Header -->
          <tr>
            <td style="padding:28px 32px 20px 32px;border-bottom:1px solid #1F2C3F;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="46" valign="middle">
                    <a href="${appUrl}" style="text-decoration:none;display:inline-block;">
                      <img src="cid:warden-logo" alt="Warden" width="40" height="40" style="display:block;border-radius:10px;border:1px solid #C6A664;background:#0B121C;" />
                    </a>
                  </td>
                  <td valign="middle" style="padding-left:14px;">
                    <div style="font-size:17px;font-weight:700;letter-spacing:0.04em;color:#F5F0E6;">WARDEN AUTOMATONS</div>
                    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#C6A664;margin-top:2px;">
                      Daily Executive Brief &middot; 12:00 AM IST
                    </div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;padding:4px 10px;background:rgba(198,166,100,0.12);border:1px solid #C6A664;border-radius:999px;font-size:11px;font-weight:600;color:#C6A664;">
                      ${metrics.date}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero KPI Ribbon -->
          <tr>
            <td style="padding:20px 32px;background-color:#0B121C;border-bottom:1px solid #1F2C3F;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="padding:4px;">
                    <div style="font-size:11px;color:#9E978C;text-transform:uppercase;letter-spacing:0.08em;">Active Users</div>
                    <div style="font-size:22px;font-weight:700;color:#F5F0E6;margin-top:4px;">${formatNum(metrics.users.dau)}</div>
                  </td>
                  <td align="center" style="padding:4px;border-left:1px solid #1F2C3F;">
                    <div style="font-size:11px;color:#9E978C;text-transform:uppercase;letter-spacing:0.08em;">Prompts Today</div>
                    <div style="font-size:22px;font-weight:700;color:#C6A664;margin-top:4px;">${formatNum(metrics.conversations.totalPromptsToday)}</div>
                  </td>
                  <td align="center" style="padding:4px;border-left:1px solid #1F2C3F;">
                    <div style="font-size:11px;color:#9E978C;text-transform:uppercase;letter-spacing:0.08em;">Daily Spend</div>
                    <div style="font-size:22px;font-weight:700;color:#D4B97B;margin-top:4px;">${formatCur(metrics.tokenSpend.costUsdToday)}</div>
                  </td>
                  <td align="center" style="padding:4px;border-left:1px solid #1F2C3F;">
                    <div style="font-size:11px;color:#9E978C;text-transform:uppercase;letter-spacing:0.08em;">Infra Latency</div>
                    <div style="font-size:22px;font-weight:700;color:#C6A664;margin-top:4px;">${metrics.infraHealth.p95LatencyMs}ms</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Section 1: Users & Retention -->
          <tr>
            <td style="padding:24px 32px 16px 32px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#C6A664;margin-bottom:12px;">
                👥 Users &amp; Retention
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0B121C;border:1px solid #1F2C3F;border-radius:12px;padding:16px;">
                <tr>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Total Registered: <strong style="color:#F5F0E6;">${formatNum(metrics.users.totalRegistered)}</strong></td>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">New Signups Today: <strong style="color:#C6A664;">+${formatNum(metrics.users.newSignupsToday)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">DAU / WAU Ratio: <strong style="color:#F5F0E6;">${((metrics.users.dau / (metrics.users.wau || 1)) * 100).toFixed(1)}%</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Monthly Active (MAU): <strong style="color:#F5F0E6;">${formatNum(metrics.users.mau)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Day-1 Retention: <strong style="color:#C6A664;">${metrics.users.retentionD1Percent.toFixed(1)}%</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Day-7 Retention: <strong style="color:#C6A664;">${metrics.users.retentionD7Percent.toFixed(1)}%</strong></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Section 2: Conversations & Prompts -->
          <tr>
            <td style="padding:16px 32px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#C6A664;margin-bottom:12px;">
                💬 Conversations &amp; Prompts
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0B121C;border:1px solid #1F2C3F;border-radius:12px;padding:16px;">
                <tr>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Active Chat Threads: <strong style="color:#F5F0E6;">${formatNum(metrics.conversations.activeThreads)}</strong></td>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Prompts Today: <strong style="color:#F5F0E6;">${formatNum(metrics.conversations.totalPromptsToday)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Avg Prompts / User: <strong style="color:#F5F0E6;">${metrics.conversations.avgPromptsPerUser.toFixed(1)}</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Avg Response Time: <strong style="color:#C6A664;">${metrics.conversations.avgResponseLatencyMs}ms</strong></td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:8px 12px 4px 12px;color:#9E978C;font-size:13px;">
                    Department distribution:
                    ${metrics.conversations.topDepartments.map((d) => `<span style="display:inline-block;background:#0F1824;border:1px solid #1F2C3F;padding:2px 8px;border-radius:6px;margin:2px 4px;color:#D8D2C5;">${d.department}: <b style="color:#C6A664;">${d.count}</b></span>`).join('')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Section 3: Agents Spawned -->
          <tr>
            <td style="padding:16px 32px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#C6A664;margin-bottom:12px;">
                🤖 Agents Spawned &amp; Execution
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0B121C;border:1px solid #1F2C3F;border-radius:12px;padding:16px;">
                <tr>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Total Agents in Roster: <strong style="color:#F5F0E6;">${metrics.agents.totalAgents}</strong></td>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Active Today: <strong style="color:#F5F0E6;">${metrics.agents.activeToday}</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Total Autonomous Runs: <strong style="color:#F5F0E6;">${formatNum(metrics.agents.totalRuns)}</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Run Success Rate: <strong style="color:#C6A664;">${metrics.agents.successRatePercent.toFixed(1)}%</strong></td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:6px 12px;color:#D8D2C5;font-size:13px;">
                    Hierarchy Distribution:
                    Level 0 (CXO): <b style="color:#C6A664;">${metrics.agents.hierarchyDistribution.level0Cxo}</b> &middot;
                    Level 1 (Leads): <b style="color:#C6A664;">${metrics.agents.hierarchyDistribution.level1Leads}</b> &middot;
                    Level 2 (Devs): <b style="color:#C6A664;">${metrics.agents.hierarchyDistribution.level2Devs}</b>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Section 4: Token Spend -->
          <tr>
            <td style="padding:16px 32px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#C6A664;margin-bottom:12px;">
                💰 Token Spend &amp; Provider Breakdown
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0B121C;border:1px solid #1F2C3F;border-radius:12px;padding:16px;">
                <tr>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Tokens In: <strong style="color:#F5F0E6;">${formatNum(metrics.tokenSpend.tokensIn)}</strong></td>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Tokens Out: <strong style="color:#F5F0E6;">${formatNum(metrics.tokenSpend.tokensOut)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Cached Tokens: <strong style="color:#C6A664;">${formatNum(metrics.tokenSpend.tokensCached)}</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Reasoning/Thinking: <strong style="color:#F5F0E6;">${formatNum(metrics.tokenSpend.tokensThinking)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Cost Today: <strong style="color:#C6A664;">${formatCur(metrics.tokenSpend.costUsdToday)}</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Quota Used: <strong style="color:#F5F0E6;">${metrics.tokenSpend.budgetUsedPercent.toFixed(1)}% of ${formatCur(metrics.tokenSpend.monthlyBudgetUsd)}</strong></td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:8px 12px 4px 12px;color:#9E978C;font-size:13px;">
                    Providers:
                    ${metrics.tokenSpend.byProvider.map((p) => `<span style="display:inline-block;background:#0F1824;border:1px solid #1F2C3F;padding:2px 8px;border-radius:6px;margin:2px 4px;color:#D8D2C5;">${p.provider}: <b style="color:#C6A664;">${formatCur(p.costUsd)}</b> (${formatNum(p.tokens)} tok)</span>`).join('')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Section 5: GA4 Traffic -->
          <tr>
            <td style="padding:16px 32px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#C6A664;margin-bottom:12px;">
                📈 GA4 Traffic &amp; Web Analytics
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0B121C;border:1px solid #1F2C3F;border-radius:12px;padding:16px;">
                <tr>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Active Web Visitors: <strong style="color:#F5F0E6;">${formatNum(metrics.ga4Traffic.activeUsers)}</strong></td>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Sessions: <strong style="color:#F5F0E6;">${formatNum(metrics.ga4Traffic.sessions)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Page Views: <strong style="color:#F5F0E6;">${formatNum(metrics.ga4Traffic.pageViews)}</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Avg Engagement: <strong style="color:#F5F0E6;">${metrics.ga4Traffic.avgEngagementDurationSec}s</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Bounce Rate: <strong style="color:#F5F0E6;">${metrics.ga4Traffic.bounceRatePercent.toFixed(1)}%</strong></td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">Traffic Top Channels: <strong style="color:#C6A664;">${metrics.ga4Traffic.topSources[0]?.source || 'Direct'} (${metrics.ga4Traffic.topSources[0]?.percentage || 0}%)</strong></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Section 6: Infra Health -->
          <tr>
            <td style="padding:16px 32px 28px 32px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#C6A664;margin-bottom:12px;">
                ⚡ Infrastructure Health
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0B121C;border:1px solid #1F2C3F;border-radius:12px;padding:16px;">
                <tr>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">
                    Postgres Pool: <strong style="color:${metrics.infraHealth.postgresStatus === 'HEALTHY' ? '#34d399' : '#f59e0b'};">${metrics.infraHealth.postgresStatus}</strong> (${metrics.infraHealth.activeDbConnections} conn)
                  </td>
                  <td width="50%" style="padding:6px 12px;color:#D8D2C5;font-size:14px;">
                    Active WebSockets: <strong style="color:#F5F0E6;">${metrics.infraHealth.activeWebSockets}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">
                    API Latency (p95): <strong style="color:#C6A664;">${metrics.infraHealth.p95LatencyMs}ms</strong>
                  </td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">
                    Node Memory: <strong style="color:#F5F0E6;">${metrics.infraHealth.memoryUsedMb}MB / ${metrics.infraHealth.memoryTotalMb}MB</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">
                    Sandbox Containers: <strong style="color:#F5F0E6;">${metrics.infraHealth.sandboxContainersActive} active</strong>
                  </td>
                  <td style="padding:6px 12px;color:#D8D2C5;font-size:14px;">
                    Uptime: <strong style="color:#F5F0E6;">${metrics.infraHealth.uptimeHours.toFixed(1)} hrs</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding:0 32px 32px 32px;">
              <a href="${appUrl}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#C6A664 0%,#D4B97B 100%);color:#0B121C;font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:10px;letter-spacing:0.02em;">
                Open Command Center Dashboard &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 32px;background-color:#0B121C;border-top:1px solid #1F2C3F;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:12px;color:#9E978C;line-height:1.5;">
                    Warden Automatons Autonomous AI Workforce OS<br/>
                    Generated at ${metrics.generatedAtIst} (IST) &middot; Nightly Dispatch
                  </td>
                  <td align="right" style="font-size:12px;color:#787166;">
                    <a href="${appUrl}" style="color:#C6A664;text-decoration:none;">warden.autos</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
