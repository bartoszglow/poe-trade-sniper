import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  DomainEvent,
  EngineKind,
  EngineStatus,
  Listing,
  TravelEvent,
} from '@poe-sniper/shared';
import { isHitSoundEnabled, playHitSound } from '../lib/hit-sound';
import { isNotifyEnabled, showSystemNotification } from '../lib/notifications';

/** Bounded-growth cap for the live feed kept in memory. */
const LIVE_HITS_CAP = 100;

export interface EngineState {
  engine: EngineKind;
  status: EngineStatus;
}

export interface TravelState {
  phase: TravelEvent['phase'];
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
  engineStateBySearchId: Record<string, EngineState>;
  travelStateByListingId: Record<string, TravelState>;
  /** Bumped on searches-changed/engine-status — pages refetch off it. */
  searchesVersion: number;
  /** Live guard state; null until the first guard event (poll fills the gap). */
  guard: GuardState | null;
}

const INITIAL_STATE: EventStreamState = {
  connected: false,
  liveHits: [],
  engineStateBySearchId: {},
  travelStateByListingId: {},
  searchesVersion: 0,
  guard: null,
};

const EventStreamContext = createContext<EventStreamState>(INITIAL_STATE);

function reduceEvent(state: EventStreamState, event: DomainEvent): EventStreamState {
  switch (event.type) {
    case 'hit':
      return {
        ...state,
        liveHits: [event.listing, ...state.liveHits].slice(0, LIVE_HITS_CAP),
      };
    case 'engine-status':
      return {
        ...state,
        engineStateBySearchId: {
          ...state.engineStateBySearchId,
          [event.searchId]: { engine: event.engine, status: event.status },
        },
        searchesVersion: state.searchesVersion + 1,
      };
    case 'searches-changed':
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
    case 'guard':
      return {
        ...state,
        guard: { tripped: event.state === 'tripped', reason: event.reason },
        searchesVersion: state.searchesVersion + 1,
      };
    case 'log':
      return state;
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
          const price = listing.price
            ? `${listing.price.amount} ${listing.price.currency}`
            : 'no price';
          showSystemNotification(`Hit: ${listing.itemName}`, `${price} · ${listing.seller ?? '?'}`);
        }
      }
      setState((previous) => reduceEvent(previous, event));
    };
    return () => source.close();
  }, []);

  const value = useMemo(() => state, [state]);
  return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>;
}

export function useEventStream(): EventStreamState {
  return useContext(EventStreamContext);
}
