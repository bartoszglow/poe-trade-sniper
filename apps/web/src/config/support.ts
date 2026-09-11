import type { ComponentType } from 'react';
import {
  Bug,
  Coffee,
  DollarSign,
  ExternalLink,
  Heart,
  Mail,
  MessageCircle,
  Star,
} from 'lucide-react';
import type { MessageKey } from '../i18n/messages';

/**
 * Single source of truth for the About & Support view — author identity, donation
 * targets and project links. A link with an EMPTY `url` is simply not rendered, so this
 * scaffold stays clean until Bartosz drops in the real URLs (search this file for TODO).
 * Centralised on purpose (no hard-coded URLs scattered across the page).
 */
export interface SupportLink {
  id: string;
  /** Literal brand label (a proper noun — not translated), e.g. "Ko-fi". */
  label?: string;
  /** OR an i18n key, for translated ACTION labels (e.g. "Report a bug"). */
  labelKey?: MessageKey;
  /** Empty string = not shown yet. */
  url: string;
  icon: ComponentType<{ className?: string }>;
}

/** The author. Name is shown as-is; the one-line bio is the i18n key `about.bio`. */
export const AUTHOR_NAME = 'Bartosz Głowacki';

/**
 * The project's GitHub home. Every repo-derived link below is built from this, so
 * a rename is a one-line change.
 *
 * NOTE: the same slug is also configured for the desktop shell's update check
 * (`apps/desktop/src/main.ts`, `GITHUB_RELEASES_REPO`) and for electron-builder's
 * publish target (`apps/desktop/package.json`). Those live in other runtimes (an
 * Electron main and a build manifest) and cannot import this module.
 */
export const REPO_OWNER = 'bartoszglow';
export const REPO_URL = `https://github.com/${REPO_OWNER}/poe-trade-sniper`;

/** Author / contact links. Fill the ones you want shown; leave the rest as ''. */
export const AUTHOR_LINKS: SupportLink[] = [
  { id: 'github', label: 'GitHub', url: `https://github.com/${REPO_OWNER}`, icon: ExternalLink },
  { id: 'x', label: 'X', url: '', icon: ExternalLink }, //       TODO(bartosz): https://x.com/<handle>
  { id: 'discord', label: 'Discord', url: '', icon: MessageCircle }, // TODO(bartosz): invite/profile
  { id: 'email', label: 'Email', url: '', icon: Mail }, //      TODO(bartosz): mailto:<address>
];

/** Donation buttons (one-time / recurring). Recommended: Ko-fi + PayPal to start. */
export const DONATION_LINKS: SupportLink[] = [
  { id: 'kofi', label: 'Ko-fi', url: '', icon: Coffee }, //       TODO(bartosz): https://ko-fi.com/<you>
  { id: 'paypal', label: 'PayPal', url: '', icon: DollarSign }, // TODO(bartosz): https://paypal.me/<you>
  { id: 'sponsors', label: 'GitHub Sponsors', url: '', icon: Heart }, // TODO(bartosz): https://github.com/sponsors/<you>
];

/** Free ways to help — only shown if the repo is public. */
export const PROJECT_LINKS: SupportLink[] = [
  { id: 'star', labelKey: 'about.star', url: REPO_URL, icon: Star },
  { id: 'bug', labelKey: 'about.reportBug', url: `${REPO_URL}/issues/new`, icon: Bug },
];

/** True while every support/author/project link is still a placeholder. */
export const hasAnySupportLink = (): boolean =>
  [...AUTHOR_LINKS, ...DONATION_LINKS, ...PROJECT_LINKS].some((link) => link.url !== '');
