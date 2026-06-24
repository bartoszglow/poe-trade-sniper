import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  BuyAutomationEvent,
  DomainEvent,
  Listing,
  NetworkLogEntry,
  TravelEvent,
} from '@poe-sniper/shared';
import { translateStatic } from '../i18n/i18n';
import { isHitSoundEnabled, playHitSound } from '../lib/hit-sound';
import { isNotifyEnabled, showSystemNotification } from '../lib/notifications';

/** Bounded-growth cap for the live feed kept in memory. */
const LIVE_HITS_CAP = 100;
/** Dev network view keeps a deeper buffer than the hits feed. */
const NETWORK_CAP = 1000;

export interface TravelState {
  phase: TravelEvent['phase'];
  detail: string | null;
}

export interface BuyState {
  phase: BuyAutomationEvent['phase'];
  detail: string | null;
}

export interface GuardState {
  tripped: boolean;
  reason: string | null;
}

export interface EventStreamState {
  /** SSE connection state — drives the "live" dot. */
  connected: boolean;
  /** Newest-first live hits (session-local, capped). */
  liveHits: Listing[];
  travelStateByListingId: Record<string, TravelState>;
  buyStateByListingId: Record<string, BuyState>;
  /** Bumped on searches-changed/engine-status — pages refetch off it. */
  searchesVersion: number;
  /** Live guard state; null until the first guard event (poll fills the gap). */
  guard: GuardState | null;
  /** Newest-first GGG network entries since page load (dev view). */
  networkEvents: NetworkLogEntry[];
}

const INITIAL_STATE: EventStreamState = {
  connected: false,
  liveHits: [],
  travelStateByListingId: {},
  buyStateByListingId: {},
  searchesVersion: 0,
  guard: null,
  networkEvents: [],
};

export interface EventStreamContextValue extends EventStreamState {
  /** Clears the session-local live-hits feed on demand (view-only, not persisted). */
  clearLiveHits: () => void;
}

const EventStreamContext = createContext<EventStreamContextValue>({
  ...INITIAL_STATE,
  clearLiveHits: () => {},
});

/** Compile-time exhaustiveness guard — a new DomainEvent member fails typecheck
 *  here until its `case` is added (the OCP claim becomes a real invariant). */
function assertNever(event: never): never {
  throw new Error(`unhandled domain event: ${JSON.stringify(event)}`);
}

function reduceEvent(state: EventStreamState, event: DomainEvent): EventStreamState {
  switch (event.type) {
    case 'hit':
      return {
        ...state,
        liveHits: [event.listing, ...state.liveHits].slice(0, LIVE_HITS_CAP),
      };
    case 'engine-status':
    case 'searches-changed':
      // Live engine/status + add/remove/edit land on the rows via a (debounced)
      // /api/searches refetch — see useSearches. Bump the version to trigger it.
      return { ...state, searchesVersion: state.searchesVersion + 1 };
    case 'travel':
      if (event.listingId === null) return state;
      return {
        ...state,
        travelStateByListingId: {
          ...state.travelStateByListingId,
          [event.listingId]: { phase: event.phase, detail: event.detail },
        },
      };
    case 'buy':
      if (event.listingId === null) return state;
      return {
        ...state,
        buyStateByListingId: {
          ...state.buyStateByListingId,
          [event.listingId]: { phase: event.phase, detail: event.detail },
        },
      };
    case 'guard':
      return {
        ...state,
        guard: { tripped: event.state === 'tripped', reason: event.reason },
        searchesVersion: state.searchesVersion + 1,
      };
    case 'network':
      return {
        ...state,
        networkEvents: [event.entry, ...state.networkEvents].slice(0, NETWORK_CAP),
      };
    case 'log':
      return state;
    default:
      return assertNever(event);
  }
}

/** One EventSource for the whole app (frontend.md: SSE, not polling). */
export function EventStreamProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EventStreamState>(INITIAL_STATE);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setState((previous) => ({ ...previous, connected: true }));
    source.onerror = () => setState((previous) => ({ ...previous, connected: false }));
    source.onmessage = (message: MessageEvent<string>) => {
      let event: DomainEvent | { type: 'heartbeat' };
      try {
        event = JSON.parse(message.data) as DomainEvent | { type: 'heartbeat' };
      } catch {
        return;
      }
      if (event.type === 'heartbeat') return;
      if (event.type === 'hit') {
        if (isHitSoundEnabled()) playHitSound();
        if (isNotifyEnabled()) {
          const { listing } = event;
          // translateStatic: this callback lives outside the React tree.
          const price = listing.price
            ? `${listing.price.amount} ${listing.price.currency}`
            : translateStatic('item.noPrice');
          showSystemNotification(
            translateStatic('notify.hitTitle', { item: listing.itemName }),
            `${price} · ${listing.seller ?? '?'}`,
          );
        }
      }
      if (event.type === 'buy' && isNotifyEnabled()) {
        // translateStatic: this callback lives outside the React tree.
        const item = event.itemName ?? '?';
        if (event.phase === 'moved') {
          showSystemNotification(
            translateStatic('notify.buyMoved', { item }),
            translateStatic('notify.buyMovedBody'),
          );
        } else if (event.phase === 'failed' || event.phase === 'aborted') {
          showSystemNotification(translateStatic('notify.buyFailed', { item }), event.detail ?? '');
        }
      }
      setState((previous) => reduceEvent(previous, event));
    };
    return () => source.close();
  }, []);

  const clearLiveHits = useCallback(
    () => setState((previous) => ({ ...previous, liveHits: [] })),
    [],
  );
  const value = useMemo(() => ({ ...state, clearLiveHits }), [state, clearLiveHits]);
  return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>;
}

export function useEventStream(): EventStreamContextValue {
  return useContext(EventStreamContext);
}
