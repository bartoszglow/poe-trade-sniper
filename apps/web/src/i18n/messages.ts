/**
 * i18n message catalog. EVERY user-facing string in the web app lives here as a
 * label, with a translation for each supported language (see docs/frontend.md).
 *
 * `EN` is the source of truth for the key set (`as const` → `MessageKey`); `PL`
 * is typed as `Record<MessageKey, string>` so the compiler rejects any missing
 * or stray key. Pluralised phrases live in the `*_PLURALS` catalogs and are
 * resolved with `Intl.PluralRules` (handles Polish one/few/many correctly).
 */

// --- Singular messages (source of truth: EN) ---

export const EN = {
  // Common
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.confirm': 'Confirm',
  'common.refresh': 'Refresh',
  'common.test': 'Test',
  'common.requestFailed': 'request failed',
  'common.live': 'live',
  'common.offline': 'offline',
  'common.connecting': 'connecting',

  // Navigation
  'nav.searches': 'Searches',
  'nav.hits': 'Hits',
  'nav.activity': 'Activity',
  'nav.network': 'Network',
  'nav.settings': 'Settings',
  'nav.about': 'About & Support',

  // About & Support view
  'about.tagline': 'Fast, free hideout-trade sniping for Path of Exile 2.',
  'about.madeBy': 'Made by',
  'about.bio': 'Full-stack developer — building this solo in my spare time.',
  'about.supportHeading': 'Support development',
  'about.supportBlurb':
    "This tool is free and built by one person. If it's saved you time or divines, a small tip keeps it growing. 🙏",
  'about.nonMonetary': 'Not into money? These help too:',
  'about.star': 'Star on GitHub',
  'about.reportBug': 'Report a bug',
  'about.comingSoon': 'Support links coming soon — thank you for your patience.',
  'about.version': 'Version {version}',
  'about.disclaimer':
    'A community fan tool. Not affiliated with or endorsed by Grinding Gear Games.',
  'activity.title': 'Activity',
  'activity.empty': 'No actions yet.',
  'activity.details': 'Item details',
  'activity.returnedHome': 'Returned to hideout',
  'activity.home': 'home',
  'activity.notHome': 'no return',
  'activity.outcome.inProgress': 'In progress',
  'activity.outcome.travelFailed': 'Travel failed',
  'activity.outcome.noShop': 'No shop',
  'activity.outcome.itemSold': 'Item sold',
  'activity.outcome.placed': 'Cursor placed',
  'activity.outcome.aborted': 'Aborted',
  'activity.outcome.unsupported': 'Unsupported',
  'activity.outcome.failed': 'Failed',

  // Network (developer) view
  'network.title': 'Network',
  'network.subtitle': 'Every request to and from GGG trade (redacted — no cookies or tokens).',
  'network.logFile': 'Log file',
  'network.copyPath': 'Copy path',
  'network.copied': 'Copied',
  'network.search': 'Search url / id / detail…',
  'network.allChannels': 'All channels',
  'network.errorsOnly': 'Errors only',
  'network.pause': 'Pause',
  'network.clear': 'Clear',
  'network.empty': 'No traffic yet — activity appears the moment the app calls GGG.',
  'network.colTime': 'Time',
  'network.colChannel': 'Ch',
  'network.colMethod': 'Method',
  'network.colEndpoint': 'Endpoint',
  'network.colPolicy': 'Policy',
  'network.colStatus': 'Status',
  'network.colDuration': 'Duration',
  'network.colOutcome': 'Outcome',
  'network.correlationId': 'Correlation ID',
  'network.rateLimit': 'Rate-limit headers',
  'network.detail': 'Detail',
  'network.ago': '{value} ago',
  'network.entriesShown': '{count} shown',

  // Detection mode (app bar pills)
  'detection.wsTitle': 'Live push (WebSocket) — instant detection',
  'detection.pollTitle': 'Polling fallback — periodic checks',

  // Update banner
  'update.available': 'A new version ({version}) is available.',
  'update.download': 'Download',

  // Status bar
  'status.serverChecking': 'server …',
  'status.server': 'server',
  'status.serverDown': 'server down',
  'status.noSession': 'no session',
  'status.session': 'session',
  'status.sessionInvalid': 'session invalid',
  'status.sessionUnprobed': 'session unprobed',
  'status.rateLimitedUntil': 'rate-limited until {time}',
  'status.searchBudget': 'search {budget}',
  'status.travelQueue': 'travel queue: {count}',

  // Outbound safety guard
  'guard.tripped': 'Safety guard tripped — all PoE traffic halted.',
  'guard.unknownReason': 'unknown reason',
  'guard.reset': 'Reset guard',

  // Expired-session banner
  'sessionBanner.expired': 'PoE session looks expired — detection cannot reach the trade API.',
  'sessionBanner.fix': 'Fix in Settings',

  // Login overlay / capture
  'login.titleExpired': 'Your PoE session expired',
  'login.titleMissing': 'Not logged in to Path of Exile',
  'login.bodyExpired':
    'The stored cookies no longer work — detection and travel are paused until you log in again.',
  'login.bodyMissing':
    'The sniper needs a PoE session to watch searches and travel. Log in once and you are set.',
  'login.again': 'Log in again',
  'login.withPoe': 'Log in with Path of Exile',
  'login.waiting': 'waiting for login…',
  'login.preferNot': 'Prefer not to log in here?',
  'login.pasteInSettings': 'Paste cookies in Settings',
  'login.failedToStart': 'failed to start',

  // Engine status badges (closed EngineStatus union)
  'engineStatus.pending': 'pending',
  'engineStatus.connecting': 'connecting',
  'engineStatus.active': 'active',
  'engineStatus.degraded': 'degraded',
  'engineStatus.stopped': 'stopped',
  'engineStatus.paused': 'paused',
  // Hover-popover explanations for the status / engine badges
  'engineStatusDesc.pending': 'Waiting to start.',
  'engineStatusDesc.connecting': 'Opening the live WebSocket connection.',
  'engineStatusDesc.active': 'Running — watching for new listings.',
  'engineStatusDesc.degraded': 'Degraded — running on the polling fallback after a problem.',
  'engineStatusDesc.stopped': 'Stopped — this search is turned off.',
  'engineStatusDesc.paused': 'Paused — detection is globally paused.',

  // Live hits panel
  'hitsPanel.title': 'Live hits',
  'hitsPanel.empty': 'New listings stream here the moment an engine detects them.',
  'hitsPanel.clear': 'Clear the live feed',
  'hitsPanel.hide': 'Hide live hits',
  'hitsPanel.show': 'Show live hits',
  'hitsPanel.resize': 'Drag to resize the live hits panel (double-click resets)',

  // Hit card / travel
  'hitCard.queued': 'queued…',
  'hitCard.traveling': 'traveling…',
  'hitCard.traveled': 'traveled ✓',
  'hitCard.failed': 'failed',
  'hitCard.travelGone': 'no longer available',
  'hitCard.travelRateLimited': 'rate-limited — try again shortly',
  'hitCard.buying': 'buying…',
  'hitCard.buyReady': 'cursor on item',
  'hitCard.buyAborted': 'buy aborted',
  'hitCard.buyFailed': 'buy failed',
  'hitCard.retry': 'Retry',
  'hitCard.retrying': 'Refreshing…',
  'hitCard.retryTitle': 'Re-check the listing for a fresh token, then travel',
  'hitCard.travel': 'Travel',
  'hitCard.travelTitle': 'Travel to seller hideout',
  'hitCard.buy': 'Buy',
  'hitCard.buyTitle': 'Travel to the seller, then move to the item (no click yet)',
  'hitCard.expired': 'expired',
  'hitCard.tokenExpired': 'token expired',
  'hitCard.locateSearch': 'Show the source search',
  'common.ago': '{value} ago',

  // Searches page
  'searches.title': 'Searches',
  'searches.reorder': 'Drag to reorder',
  'searches.fieldInput': 'Search id or URL',
  'searches.fieldInputHint':
    'paste from the trade site — it defines the query, league and purchase type',
  'searches.fieldInputPlaceholder': 'AbCdEf123 or https://…/trade2/search/…',
  'searches.fieldLabel': 'Label',
  'searches.fieldLabelPlaceholder': 'T1 ES boots',
  'searches.fieldLeague': 'League',
  'searches.fieldLeagueHint': 'a bare id needs one',
  'searches.autoTravel': 'Auto travel',
  'searches.autoTravelInline': 'auto-travel',
  'searches.autoTravelWarning': 'teleports your character — Instant Buyout only',
  'searches.watch': 'Watch search',
  'searches.addCta': 'Watch a search',
  'searches.detectionToggle': 'Detection',
  'searches.editLabel': 'Rename',
  'searches.saveLabel': 'Save name',
  'searches.editSearch': 'Edit search',
  'searches.openOnTradeSite': 'Open this search on the trade site',
  'searches.editLabelField': 'Label',
  'searches.editSearchField': 'Search (id or trade URL)',
  'searches.editSearchHint': 'Re-points this row to a new search — your hits stay.',
  'searches.empty': 'No watched searches yet — paste a trade search id or URL above.',
  'searches.travelToggle': 'TRAVEL',
  'searches.buyToggle': 'BUY',
  'searches.buyFor': 'Auto buy for {label}',
  'searches.buyWebOnly': 'desktop app only',
  'searches.buyUnsupportedOs': 'macOS only',
  'searches.buyNeedsPermission': 'grant permissions in Settings',
  'searches.activeToggle': 'ACTIVE',
  'searches.activeFor': 'Detection active for {label}',
  'searches.autoFor': 'Auto travel for {label}',
  'searches.remove': 'Remove {label}',
  'searches.archive': 'Archive {label}',
  'searches.restore': 'Restore {label}',
  'searches.archivedSection': 'Archived',
  'searches.archivedOn': 'archived {time}',
  'searches.last': 'last {time}',
  'searches.loginRequiredTitle': 'Log in to start sniping',
  'searches.loginRequiredBody':
    'Connect your Path of Exile session before you can add searches and detect listings.',
  'searches.loginRequiredCta': 'Go to Settings',

  // Rooms — named groups of searches (#33)
  'rooms.new': 'New room',
  'rooms.defaultName': 'New room',
  'rooms.nameLabel': 'Room name',
  'rooms.rename': 'Rename room',
  'rooms.reorder': 'Drag to move the room',
  'rooms.collapse': 'Collapse room',
  'rooms.expand': 'Expand room',
  'rooms.empty': 'Drop searches here',
  'rooms.activeFor': 'Detection active for room {name}',
  'rooms.delete': 'Delete room {name}',
  'rooms.deleteTitle': 'Delete room',
  'rooms.deleteRelease': 'Move searches out',
  'rooms.deleteWithSearches': 'Delete searches too',

  // Search criteria view
  'criteria.show': 'Show criteria',
  'criteria.hide': 'Hide criteria',
  'criteria.item': 'Item',
  'criteria.purchase': 'Purchase',
  'criteria.price': 'Price',
  'criteria.stats': 'Stats',
  'criteria.disabledTag': 'disabled',
  'criteria.group.type': 'Type',
  'criteria.group.equipment': 'Equipment',
  'criteria.group.requirements': 'Requirements',
  'criteria.group.misc': 'Miscellaneous',
  'criteria.group.trade': 'Trade',
  'criteria.other': 'Other',
  'criteria.empty': 'No criteria — this search matches everything.',
  'criteria.loading': 'Resolving criteria…',

  // Hits page
  'hits.title': 'Hits',
  'hits.allSearches': 'All searches',
  'hits.filterBySearch': 'Filter by search',
  'hits.searchPlaceholder': 'Search item or seller…',
  'hits.from': 'From',
  'hits.to': 'To',
  'hits.sort': 'Sort',
  'hits.sortNewest': 'Newest',
  'hits.sortOldest': 'Oldest',
  'hits.sortName': 'Name A–Z',
  'hits.loading': 'Loading…',
  'hits.empty':
    'No persisted detections yet. Hits land here (and in the live panel) once a watched search fires.',
  'hits.noItemPayload': 'no item payload recorded',

  // Item detail
  'item.title': 'Item',
  'item.base': 'Base',
  'item.itemLevel': 'Item level',
  'item.mods': 'Mods',
  'item.properties': 'Properties',
  'item.requirements': 'Requirements',
  'item.ilvl': 'ilvl {level}',
  'item.corrupted': 'Corrupted',
  'item.noPrice': 'no price',

  // Settings
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageHint': 'Interface language — applies immediately.',
  'settings.session': 'PoE session',
  'settings.noSession': 'No session stored.',
  'settings.loggedIn': 'logged in',
  'settings.invalid': 'invalid',
  'settings.notVerified': 'not verified',
  'settings.captured': 'captured {date}',
  'settings.verify': 'Verify session',
  'settings.probeFailed': 'probe failed — session looks stale',
  'settings.clear': 'Clear session',
  'settings.confirmClear': 'Confirm clear',
  'settings.cleared': 'session cleared',
  'settings.loginCard': 'Log in with Path of Exile',
  'settings.loginCardBody':
    'Opens the real pathofexile.com page in your Chrome — credentials go only to GGG; once you finish logging in there, the session is captured and the window closes itself.',
  'settings.pasteCard': 'Paste cookies instead',
  'settings.pasteCardBody':
    'Prefer not to log in inside the app? Copy the cookies from your own browser (devtools → Application → Cookies → pathofexile.com). Values are stored locally, never displayed and never logged.',
  'settings.hintRequired': 'required',
  'settings.hintCfClearance': 'optional — include if Cloudflare challenged you',
  'settings.hintUserAgent':
    "paste your browser's UA when cf_clearance is set (Cloudflare binds them)",
  'settings.uaPlaceholder': 'leave empty for the server default',
  'settings.saveSession': 'Save session',
  'settings.savedVerified': 'session saved and verified — logged in',
  'settings.savedUnverified': 'session saved but the login probe failed — cookies may be stale',
  'settings.alerts': 'Alerts',
  'settings.cursor': 'Cursor movement',
  'settings.cursorInstant': 'Instant jump',
  'settings.cursorSmooth': 'Smooth glide',
  'settings.cursorHint': 'How the cursor moves onto the item when buying.',
  'settings.data': 'Backup / data',
  'settings.dataDesc':
    'Export your searches (JSON, restorable) and logs (CSV for Excel), or import searches from a file.',
  'settings.exportSearches': 'Export searches',
  'settings.exportHits': 'Export hits (CSV)',
  'settings.exportActivity': 'Export activity (CSV)',
  'settings.importSearches': 'Import searches',
  'settings.importBadFile': 'Could not read that file — expected a searches JSON export.',
  'settings.importDone': 'Imported {imported}, skipped {skipped}.',
  'settings.importErrors': 'errors',
  'settings.hitSound': 'Hit sound',
  'settings.hitSoundDesc': 'play a sound on every detected hit',
  'settings.volume': 'Volume',
  'settings.systemNotifications': 'System notifications',
  'settings.systemNotificationsDesc': 'system notification on every hit',
  'settings.audioUnlockNote':
    'Browsers unlock audio after the first interaction — hit Test once after opening the app.',
  'settings.developer': 'Developer',
  'settings.networkView': 'Network view',
  'settings.networkViewDesc':
    'show the GGG request log in the sidebar (the log file is always written)',
  'settings.permissions.title': 'macOS permissions',
  'settings.permissions.intro':
    'The desktop automation needs these. Toggle to grant; if already granted, opens System Settings to manage — the app only reflects what you set there.',
  'settings.permissions.screenRecording': 'Screen Recording',
  'settings.permissions.screenRecordingDesc': 'See the game window (capture).',
  'settings.permissions.accessibility': 'Accessibility',
  'settings.permissions.accessibilityDesc': 'Move the cursor over the item.',
  'settings.permissions.granted': 'granted',
  'settings.permissions.denied': 'denied',
  'settings.permissions.notDetermined': 'not granted',
  'settings.permissions.restricted': 'managed by your organization',
  'settings.permissions.unsupported': 'available in the installed app',
  'settings.budgets': 'Rate-limit budgets',
  'settings.budgetsEmpty':
    'No live data yet — budgets appear after the first GGG request (read from X-Rate-Limit headers, never hardcoded).',
  'settings.budgetRule': '{used}/{max} per {period}s',

  // System notifications
  'notify.appName': 'PoE Trade Sniper',
  'notify.enabled': 'System notifications enabled',
  'notify.testBody': 'Test alert — this is how a hit looks',
  'notify.hitTitle': 'Hit: {item}',
  'notify.buyMoved': 'Buy ready — cursor on {item}',
  'notify.buyMovedBody': 'Review and confirm the purchase yourself (no auto-click).',
  'notify.buyFailed': 'Buy failed — {item}',
} as const;

export type MessageKey = keyof typeof EN;

export const PL: Record<MessageKey, string> = {
  // Common
  'common.cancel': 'Anuluj',
  'common.close': 'Zamknij',
  'common.save': 'Zapisz',
  'common.confirm': 'Potwierdź',
  'common.refresh': 'Odśwież',
  'common.test': 'Test',
  'common.requestFailed': 'żądanie nie powiodło się',
  'common.live': 'na żywo',
  'common.offline': 'offline',
  'common.connecting': 'łączenie',

  // Navigation
  'nav.searches': 'Wyszukiwania',
  'nav.hits': 'Trafienia',
  'nav.activity': 'Aktywność',
  'nav.network': 'Sieć',
  'nav.settings': 'Ustawienia',
  'nav.about': 'O programie i wsparcie',

  // About & Support view
  'about.tagline': 'Szybki, darmowy sniper ofert handlowych do Path of Exile 2.',
  'about.madeBy': 'Autor',
  'about.bio': 'Programista full-stack — tworzę to solo, po godzinach.',
  'about.supportHeading': 'Wesprzyj rozwój',
  'about.supportBlurb':
    'To narzędzie jest darmowe i tworzone przez jedną osobę. Jeśli oszczędziło Ci czas lub diviny, drobny napiwek pomaga je rozwijać. 🙏',
  'about.nonMonetary': 'Nie chcesz wpłacać? To też pomaga:',
  'about.star': 'Gwiazdka na GitHubie',
  'about.reportBug': 'Zgłoś błąd',
  'about.comingSoon': 'Linki do wsparcia wkrótce — dziękuję za cierpliwość.',
  'about.version': 'Wersja {version}',
  'about.disclaimer':
    'Narzędzie fanowskie. Niepowiązane z Grinding Gear Games ani przez nich wspierane.',
  'activity.title': 'Aktywność',
  'activity.empty': 'Brak akcji.',
  'activity.details': 'Szczegóły przedmiotu',
  'activity.returnedHome': 'Powrót do hideoutu',
  'activity.home': 'w hideout',
  'activity.notHome': 'brak powrotu',
  'activity.outcome.inProgress': 'W toku',
  'activity.outcome.travelFailed': 'Podróż nieudana',
  'activity.outcome.noShop': 'Brak sklepu',
  'activity.outcome.itemSold': 'Sprzedany',
  'activity.outcome.placed': 'Kursor na przedmiocie',
  'activity.outcome.aborted': 'Przerwano',
  'activity.outcome.unsupported': 'Nieobsługiwane',
  'activity.outcome.failed': 'Nieudane',

  // Network (developer) view
  'network.title': 'Sieć',
  'network.subtitle': 'Każdy request do i z GGG trade (zredagowane — bez cookies i tokenów).',
  'network.logFile': 'Plik logu',
  'network.copyPath': 'Kopiuj ścieżkę',
  'network.copied': 'Skopiowano',
  'network.search': 'Szukaj url / id / detal…',
  'network.allChannels': 'Wszystkie kanały',
  'network.errorsOnly': 'Tylko błędy',
  'network.pause': 'Pauza',
  'network.clear': 'Wyczyść',
  'network.empty': 'Brak ruchu — aktywność pojawi się gdy aplikacja odpyta GGG.',
  'network.colTime': 'Czas',
  'network.colChannel': 'Kan',
  'network.colMethod': 'Metoda',
  'network.colEndpoint': 'Endpoint',
  'network.colPolicy': 'Polityka',
  'network.colStatus': 'Status',
  'network.colDuration': 'Czas trw.',
  'network.colOutcome': 'Wynik',
  'network.correlationId': 'Correlation ID',
  'network.rateLimit': 'Nagłówki rate-limit',
  'network.detail': 'Szczegóły',
  'network.ago': '{value} temu',
  'network.entriesShown': 'pokazano: {count}',

  // Detection mode (app bar pills)
  'detection.wsTitle': 'Push na żywo (WebSocket) — natychmiastowe wykrywanie',
  'detection.pollTitle': 'Tryb zapasowy (polling) — okresowe sprawdzanie',

  // Update banner
  'update.available': 'Dostępna jest nowa wersja ({version}).',
  'update.download': 'Pobierz',

  // Status bar
  'status.serverChecking': 'serwer …',
  'status.server': 'serwer',
  'status.serverDown': 'serwer nie działa',
  'status.noSession': 'brak sesji',
  'status.session': 'sesja',
  'status.sessionInvalid': 'sesja nieważna',
  'status.sessionUnprobed': 'sesja niezweryfikowana',
  'status.rateLimitedUntil': 'limit zapytań do {time}',
  'status.searchBudget': 'wyszukiwanie {budget}',
  'status.travelQueue': 'kolejka podróży: {count}',

  // Outbound safety guard
  'guard.tripped': 'Bezpiecznik zadziałał — cały ruch do PoE wstrzymany.',
  'guard.unknownReason': 'nieznany powód',
  'guard.reset': 'Zresetuj bezpiecznik',

  // Expired-session banner
  'sessionBanner.expired':
    'Sesja PoE wygląda na wygasłą — wykrywanie nie może połączyć się z API trade.',
  'sessionBanner.fix': 'Napraw w Ustawieniach',

  // Login overlay / capture
  'login.titleExpired': 'Twoja sesja PoE wygasła',
  'login.titleMissing': 'Nie zalogowano do Path of Exile',
  'login.bodyExpired':
    'Zapisane cookies już nie działają — wykrywanie i podróże są wstrzymane do ponownego zalogowania.',
  'login.bodyMissing':
    'Sniper potrzebuje sesji PoE, aby obserwować wyszukiwania i podróżować. Zaloguj się raz i gotowe.',
  'login.again': 'Zaloguj się ponownie',
  'login.withPoe': 'Zaloguj przez Path of Exile',
  'login.waiting': 'oczekiwanie na logowanie…',
  'login.preferNot': 'Wolisz nie logować się tutaj?',
  'login.pasteInSettings': 'Wklej cookies w Ustawieniach',
  'login.failedToStart': 'nie udało się uruchomić',

  // Engine status badges
  'engineStatus.pending': 'oczekuje',
  'engineStatus.connecting': 'łączenie',
  'engineStatus.active': 'aktywny',
  'engineStatus.degraded': 'niestabilny',
  'engineStatus.stopped': 'zatrzymany',
  'engineStatus.paused': 'wstrzymany',
  // Objaśnienia (popover po najechaniu) dla plakietek statusu / silnika
  'engineStatusDesc.pending': 'Oczekuje na start.',
  'engineStatusDesc.connecting': 'Otwieranie połączenia WebSocket na żywo.',
  'engineStatusDesc.active': 'Działa — nasłuchuje nowych ofert.',
  'engineStatusDesc.degraded': 'Ograniczony — działa na trybie zapasowym (polling) po problemie.',
  'engineStatusDesc.stopped': 'Zatrzymany — ten search jest wyłączony.',
  'engineStatusDesc.paused': 'Wstrzymany — wykrywanie jest globalnie wstrzymane.',

  // Live hits panel
  'hitsPanel.title': 'Trafienia na żywo',
  'hitsPanel.empty': 'Nowe oferty pojawią się tutaj, gdy tylko silnik je wykryje.',
  'hitsPanel.clear': 'Wyczyść widok',
  'hitsPanel.hide': 'Ukryj trafienia na żywo',
  'hitsPanel.show': 'Pokaż trafienia na żywo',
  'hitsPanel.resize': 'Przeciągnij, aby zmienić szerokość panelu (dwuklik przywraca domyślną)',

  // Hit card / travel
  'hitCard.queued': 'w kolejce…',
  'hitCard.traveling': 'podróż…',
  'hitCard.traveled': 'przeniesiono ✓',
  'hitCard.failed': 'niepowodzenie',
  'hitCard.travelGone': 'już niedostępny',
  'hitCard.travelRateLimited': 'limit zapytań — spróbuj za chwilę',
  'hitCard.buying': 'kupowanie…',
  'hitCard.buyReady': 'kursor na przedmiocie',
  'hitCard.buyAborted': 'zakup przerwany',
  'hitCard.buyFailed': 'zakup nieudany',
  'hitCard.retry': 'Ponów',
  'hitCard.retrying': 'Odświeżanie…',
  'hitCard.retryTitle': 'Sprawdź ofertę ponownie po świeży token, potem podróżuj',
  'hitCard.travel': 'Podróżuj',
  'hitCard.travelTitle': 'Podróżuj do kryjówki sprzedawcy',
  'hitCard.buy': 'Kup',
  'hitCard.buyTitle': 'Podróżuj do sprzedawcy i najedź na przedmiot (na razie bez kliknięcia)',
  'hitCard.expired': 'wygasł',
  'hitCard.tokenExpired': 'token wygasł',
  'hitCard.locateSearch': 'Pokaż wyszukiwanie źródłowe',
  'common.ago': '{value} temu',

  // Searches page
  'searches.title': 'Wyszukiwania',
  'searches.reorder': 'Przeciągnij, aby zmienić kolejność',
  'searches.fieldInput': 'Id lub URL wyszukiwania',
  'searches.fieldInputHint': 'wklej ze strony trade — definiuje zapytanie, ligę i tryb zakupu',
  'searches.fieldInputPlaceholder': 'AbCdEf123 lub https://…/trade2/search/…',
  'searches.fieldLabel': 'Etykieta',
  'searches.fieldLabelPlaceholder': 'Buty ES T1',
  'searches.fieldLeague': 'Liga',
  'searches.fieldLeagueHint': 'samo id wymaga ligi',
  'searches.autoTravel': 'Automatyczna podróż',
  'searches.autoTravelInline': 'auto-podróż',
  'searches.autoTravelWarning': 'teleportuje twoją postać — tylko Instant Buyout',
  'searches.watch': 'Obserwuj wyszukiwanie',
  'searches.addCta': 'Obserwuj wyszukiwanie',
  'searches.detectionToggle': 'Detekcja',
  'searches.editLabel': 'Zmień nazwę',
  'searches.saveLabel': 'Zapisz nazwę',
  'searches.editSearch': 'Edytuj search',
  'searches.openOnTradeSite': 'Otwórz ten search na stronie handlu',
  'searches.editLabelField': 'Etykieta',
  'searches.editSearchField': 'Search (id lub URL handlu)',
  'searches.editSearchHint': 'Przekierowuje wiersz na nowy search — trafienia pozostają.',
  'searches.empty': 'Brak obserwowanych wyszukiwań — wklej powyżej id lub URL wyszukiwania.',
  'searches.travelToggle': 'PODRÓŻ',
  'searches.buyToggle': 'ZAKUP',
  'searches.buyFor': 'Automatyczny zakup dla {label}',
  'searches.buyWebOnly': 'tylko aplikacja desktop',
  'searches.buyUnsupportedOs': 'tylko macOS',
  'searches.buyNeedsPermission': 'przyznaj uprawnienia w Ustawieniach',
  'searches.activeToggle': 'AKTYWNY',
  'searches.activeFor': 'Wykrywanie aktywne dla {label}',
  'searches.autoFor': 'Automatyczna podróż dla {label}',
  'searches.remove': 'Usuń {label}',
  'searches.archive': 'Archiwizuj {label}',
  'searches.restore': 'Przywróć {label}',
  'searches.archivedSection': 'Zarchiwizowane',
  'searches.archivedOn': 'zarchiwizowano {time}',
  'searches.last': 'ostatnie {time}',
  'searches.loginRequiredTitle': 'Zaloguj się, aby zacząć',
  'searches.loginRequiredBody':
    'Połącz swoją sesję Path of Exile, zanim dodasz wyszukiwania i zaczniesz wykrywać oferty.',
  'searches.loginRequiredCta': 'Przejdź do Ustawień',

  // Pokoje — nazwane grupy wyszukiwań (#33)
  'rooms.new': 'Nowy pokój',
  'rooms.defaultName': 'Nowy pokój',
  'rooms.nameLabel': 'Nazwa pokoju',
  'rooms.rename': 'Zmień nazwę pokoju',
  'rooms.reorder': 'Przeciągnij, aby przenieść pokój',
  'rooms.collapse': 'Zwiń pokój',
  'rooms.expand': 'Rozwiń pokój',
  'rooms.empty': 'Przeciągnij tu wyszukiwania',
  'rooms.activeFor': 'Wykrywanie aktywne dla pokoju {name}',
  'rooms.delete': 'Usuń pokój {name}',
  'rooms.deleteTitle': 'Usuń pokój',
  'rooms.deleteRelease': 'Przenieś wyszukiwania na zewnątrz',
  'rooms.deleteWithSearches': 'Usuń też wyszukiwania',

  // Search criteria view
  'criteria.show': 'Pokaż kryteria',
  'criteria.hide': 'Ukryj kryteria',
  'criteria.item': 'Przedmiot',
  'criteria.purchase': 'Zakup',
  'criteria.price': 'Cena',
  'criteria.stats': 'Staty',
  'criteria.disabledTag': 'wyłączone',
  'criteria.group.type': 'Typ',
  'criteria.group.equipment': 'Ekwipunek',
  'criteria.group.requirements': 'Wymagania',
  'criteria.group.misc': 'Różne',
  'criteria.group.trade': 'Handel',
  'criteria.other': 'Inne',
  'criteria.empty': 'Brak kryteriów — to wyszukiwanie pasuje do wszystkiego.',
  'criteria.loading': 'Pobieranie kryteriów…',

  // Hits page
  'hits.title': 'Trafienia',
  'hits.allSearches': 'Wszystkie wyszukiwania',
  'hits.filterBySearch': 'Filtruj po wyszukiwaniu',
  'hits.searchPlaceholder': 'Szukaj przedmiotu lub sprzedawcy…',
  'hits.from': 'Od',
  'hits.to': 'Do',
  'hits.sort': 'Sortuj',
  'hits.sortNewest': 'Najnowsze',
  'hits.sortOldest': 'Najstarsze',
  'hits.sortName': 'Nazwa A–Z',
  'hits.loading': 'Ładowanie…',
  'hits.empty':
    'Brak zapisanych wykryć. Trafienia pojawią się tutaj (i w panelu na żywo), gdy obserwowane wyszukiwanie zadziała.',
  'hits.noItemPayload': 'brak zapisanych danych przedmiotu',

  // Item detail
  'item.title': 'Przedmiot',
  'item.base': 'Baza',
  'item.itemLevel': 'Poziom przedmiotu',
  'item.mods': 'Modyfikatory',
  'item.properties': 'Właściwości',
  'item.requirements': 'Wymagania',
  'item.ilvl': 'ilvl {level}',
  'item.corrupted': 'Skażony',
  'item.noPrice': 'brak ceny',

  // Settings
  'settings.title': 'Ustawienia',
  'settings.language': 'Język',
  'settings.languageHint': 'Język interfejsu — działa od razu.',
  'settings.session': 'Sesja PoE',
  'settings.noSession': 'Brak zapisanej sesji.',
  'settings.loggedIn': 'zalogowano',
  'settings.invalid': 'nieważna',
  'settings.notVerified': 'niezweryfikowana',
  'settings.captured': 'zapisana {date}',
  'settings.verify': 'Zweryfikuj sesję',
  'settings.probeFailed': 'weryfikacja nie powiodła się — sesja wygląda na nieaktualną',
  'settings.clear': 'Wyczyść sesję',
  'settings.confirmClear': 'Potwierdź czyszczenie',
  'settings.cleared': 'sesja wyczyszczona',
  'settings.loginCard': 'Logowanie przez Path of Exile',
  'settings.loginCardBody':
    'Otwiera prawdziwą stronę pathofexile.com w twoim Chrome — dane logowania trafiają wyłącznie do GGG; po zalogowaniu sesja zostaje przechwycona, a okno samo się zamyka.',
  'settings.pasteCard': 'Albo wklej cookies',
  'settings.pasteCardBody':
    'Wolisz nie logować się w aplikacji? Skopiuj cookies z własnej przeglądarki (devtools → Application → Cookies → pathofexile.com). Wartości są przechowywane lokalnie, nigdy nie są wyświetlane ani logowane.',
  'settings.hintRequired': 'wymagane',
  'settings.hintCfClearance': 'opcjonalne — dodaj, jeśli Cloudflare cię weryfikował',
  'settings.hintUserAgent':
    'wklej User-Agent swojej przeglądarki, gdy ustawiasz cf_clearance (Cloudflare je wiąże)',
  'settings.uaPlaceholder': 'puste = wartość domyślna serwera',
  'settings.saveSession': 'Zapisz sesję',
  'settings.savedVerified': 'sesja zapisana i zweryfikowana — zalogowano',
  'settings.savedUnverified':
    'sesja zapisana, ale weryfikacja logowania nie powiodła się — cookies mogą być nieaktualne',
  'settings.alerts': 'Alerty',
  'settings.cursor': 'Ruch kursora',
  'settings.cursorInstant': 'Natychmiastowy przeskok',
  'settings.cursorSmooth': 'Płynny ruch',
  'settings.cursorHint': 'Jak kursor przesuwa się na przedmiot podczas zakupu.',
  'settings.data': 'Kopia / dane',
  'settings.dataDesc':
    'Wyeksportuj wyszukiwania (JSON, do przywrócenia) i logi (CSV do Excela) albo zaimportuj wyszukiwania z pliku.',
  'settings.exportSearches': 'Eksportuj wyszukiwania',
  'settings.exportHits': 'Eksportuj trafienia (CSV)',
  'settings.exportActivity': 'Eksportuj aktywność (CSV)',
  'settings.importSearches': 'Importuj wyszukiwania',
  'settings.importBadFile': 'Nie udało się odczytać pliku — oczekiwano eksportu wyszukiwań JSON.',
  'settings.importDone': 'Zaimportowano {imported}, pominięto {skipped}.',
  'settings.importErrors': 'błędów',
  'settings.hitSound': 'Dźwięk trafienia',
  'settings.hitSoundDesc': 'odtwarzaj dźwięk przy każdym wykrytym trafieniu',
  'settings.volume': 'Głośność',
  'settings.systemNotifications': 'Powiadomienia systemowe',
  'settings.systemNotificationsDesc': 'powiadomienie systemowe przy każdym trafieniu',
  'settings.audioUnlockNote':
    'Przeglądarka odblokowuje dźwięk po pierwszej interakcji — kliknij Test raz po otwarciu aplikacji.',
  'settings.developer': 'Deweloper',
  'settings.networkView': 'Widok sieci',
  'settings.networkViewDesc':
    'pokaż log requestów GGG w panelu bocznym (plik logu pisze się zawsze)',
  'settings.permissions.title': 'Uprawnienia macOS',
  'settings.permissions.intro':
    'Automatyzacja desktopowa ich wymaga. Przełącz, aby przyznać; jeśli już przyznane, otwiera Ustawienia systemowe — aplikacja tylko odzwierciedla to, co tam ustawisz.',
  'settings.permissions.screenRecording': 'Nagrywanie ekranu',
  'settings.permissions.screenRecordingDesc': 'Widzi okno gry (przechwytywanie).',
  'settings.permissions.accessibility': 'Dostępność',
  'settings.permissions.accessibilityDesc': 'Ruch kursora nad przedmiotem.',
  'settings.permissions.granted': 'przyznane',
  'settings.permissions.denied': 'odrzucone',
  'settings.permissions.notDetermined': 'nieprzyznane',
  'settings.permissions.restricted': 'zarządzane przez organizację',
  'settings.permissions.unsupported': 'dostępne w zainstalowanej aplikacji',
  'settings.budgets': 'Limity zapytań',
  'settings.budgetsEmpty':
    'Brak danych — limity pojawią się po pierwszym zapytaniu do GGG (odczytywane z nagłówków X-Rate-Limit, nigdy nie zaszyte na stałe).',
  'settings.budgetRule': '{used}/{max} na {period}s',

  // System notifications
  'notify.appName': 'PoE Trade Sniper',
  'notify.enabled': 'Powiadomienia systemowe włączone',
  'notify.testBody': 'Alert testowy — tak wygląda trafienie',
  'notify.hitTitle': 'Trafienie: {item}',
  'notify.buyMoved': 'Zakup gotowy — kursor na {item}',
  'notify.buyMovedBody': 'Sprawdź i potwierdź zakup samodzielnie (bez auto-kliknięcia).',
  'notify.buyFailed': 'Zakup nieudany — {item}',
};

// --- Pluralised phrases (Intl.PluralRules categories) ---

export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export const EN_PLURALS = {
  'searches.hitCount': { one: '{count} hit', other: '{count} hits' },
  'rooms.memberCount': { one: '{count} search', other: '{count} searches' },
  'rooms.deleteBody': {
    one: 'The room "{name}" contains {count} search. Delete it too, or move it out?',
    other: 'The room "{name}" contains {count} searches. Delete them too, or move them out?',
  },
} as const satisfies Record<string, PluralForms>;

export type PluralKey = keyof typeof EN_PLURALS;

export const PL_PLURALS: Record<PluralKey, PluralForms> = {
  'searches.hitCount': {
    one: '{count} trafienie',
    few: '{count} trafienia',
    many: '{count} trafień',
    other: '{count} trafienia',
  },
  'rooms.memberCount': {
    one: '{count} wyszukiwanie',
    few: '{count} wyszukiwania',
    many: '{count} wyszukiwań',
    other: '{count} wyszukiwania',
  },
  'rooms.deleteBody': {
    one: 'Pokój „{name}” zawiera {count} wyszukiwanie. Usunąć je razem z pokojem, czy przenieść na zewnątrz?',
    few: 'Pokój „{name}” zawiera {count} wyszukiwania. Usunąć je razem z pokojem, czy przenieść na zewnątrz?',
    many: 'Pokój „{name}” zawiera {count} wyszukiwań. Usunąć je razem z pokojem, czy przenieść na zewnątrz?',
    other:
      'Pokój „{name}” zawiera {count} wyszukiwania. Usunąć je razem z pokojem, czy przenieść na zewnątrz?',
  },
};
