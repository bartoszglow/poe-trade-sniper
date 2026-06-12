# PoE Trade Sniper

[English](README.md) · **Polski**

**Zgarnij ofertę zanim zrobi to ktokolwiek inny.** Aplikacja desktopowa, która
obserwuje Twoje wyszukiwania na trade Path of Exile 2, wykrywa nową ofertę w
ciągu **sekund** od jej pojawienia się, powiadamia Cię i przenosi Cię prosto do
hideoutu sprzedawcy — **bez przeglądarki, bez spamowania F5, bez kopiowania
whisperów.** Przełączasz się do gry, a przedmiot już tam jest.

> Dostępna na **Windows · macOS · Linux** — [pobierz najnowszą wersję ↓](#instalacja)

![platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![license](https://img.shields.io/badge/license-UNLICENSED-lightgrey)

---

## Dlaczego warto

Dobre okazje na trade PoE2 znikają w kilka sekund. Zanim odświeżysz, klikniesz
ofertę, skopiujesz whisper i przełączysz się do gry — już jej nie ma. Ta
aplikacja zwija cały ten łańcuch do **jednego powiadomienia i jednego skoku**:

- ⚡ **Natychmiastowe wykrywanie.** Trzyma żywe połączenie WebSocket do każdego
  wyszukiwania — ten sam kanał push, którego używa strona trade — więc o ofercie
  dowiadujesz się w momencie jej pojawienia, a nie przy następnym odświeżeniu.
  Polling jako zapas pokrywa każdą przerwę w połączeniu, więc nie przegapisz okna.
- 🚀 **Przeniesienie bez przeglądarki.** Wykrywa trafienie → automatycznie
  przenosi Cię do hideoutu sprzedawcy w grze (opcjonalnie, per wyszukiwanie).
  Bez przeglądarki, bez ręcznego whispera. Ty tylko finalizujesz transakcję.
- 🎯 **Wiele wyszukiwań naraz.** Każde wyszukiwanie działa jak osobna zakładka
  trade. Wstrzymaj dowolne bez usuwania (zachowuje historię trafień), włącz
  ponownie później.
- 🔔 **Alerty po Twojemu.** Powiadomienie systemowe + dźwięk przy każdym
  trafieniu, z suwakiem głośności. Lista trafień na żywo pokazuje co przed chwilą
  wpadło i jak dawno.
- 🧾 **Zobacz dokładnie czego szukasz.** Wklej URL lub ID wyszukiwania, a
  aplikacja pokaże rozłożone na czynniki kryteria (przedmiot, mody, limit ceny)
  zanim cokolwiek zatwierdzisz — koniec ze zgadywaniem co właściwie filtruje
  zapisane wyszukiwanie.
- 🗂️ **Pełna historia trafień.** Przeszukuj, filtruj po dacie i sortuj wszystko,
  co kiedykolwiek złapałeś; nieskończony scroll, szczegóły przedmiotu w czytelnych
  kartach.
- 🌍 **Interfejs po angielsku i po polsku** od ręki.
- 🔒 **Prywatność z założenia.** Twoja sesja jest szyfrowana w spoczynku w
  keychainie systemu. Nic nie jest wysyłane nigdzie poza samo Path of Exile.
  Logi diagnostyczne są zredagowane — nigdy nie zawierają ciasteczka ani tokenu
  sesji.
- 🛡️ **Wbudowany hamulec bezpieczeństwa.** Twarde limity ruchu wychodzącego na
  minutę, żeby aplikacja nigdy nie mogła się rozpędzić i zalać trade API w Twoim
  imieniu.

---

## Instalacja

Pobierz instalator dla swojego systemu ze
[**strony Releases**](https://github.com/bartoszglow/poe-trade-sniper/releases/latest):

| System  | Plik               | Uwagi                |
| ------- | ------------------ | -------------------- |
| Windows | `...-x64.exe`      | instalator NSIS, x64 |
| macOS   | `...-arm64.dmg`    | Apple Silicon        |
| Linux   | `...-x64.AppImage` | `chmod +x` i uruchom |

> **Uwaga: buildy są niepodpisane.** Certyfikaty do podpisywania kodu kosztują,
> więc na razie system ostrzeże Cię przy pierwszym uruchomieniu. Aplikacja jest
> otwarta, a jej ruch da się zaudytować — a oto jak ominąć ostrzeżenie:
>
> - **Windows** — SmartScreen pokaże „Windows protected your PC" → kliknij **More
>   info** → **Run anyway**.
> - **macOS** — jeśli pojawi się _„aplikacja jest uszkodzona / nie można jej
>   otworzyć"_, otwórz Terminal i wpisz
>   `xattr -cr "/Applications/PoE Trade Sniper.app"`, potem uruchom. (Albo
>   prawy klik na aplikację → **Otwórz** → **Otwórz**.)
> - **Linux** — `chmod +x PoE-Trade-Sniper-*.AppImage` i kliknij dwukrotnie /
>   uruchom.

---

## Jak używać

1. **Uruchom aplikację** i wejdź w **Ustawienia → Zaloguj się przez Path of
   Exile**. Otworzy się prawdziwe okno przeglądarki; zaloguj się na oficjalnej
   stronie pathofexile.com jak zwykle. Przechwytywane jest tylko ciasteczko
   sesji i jest szyfrowane lokalnie — aplikacja nigdy nie widzi Twojego hasła.
2. **Dodaj wyszukiwanie.** Wklej **URL** wyszukiwania trade (albo samo **ID**) ze
   strony trade PoE2. Kliknij **Pokaż kryteria**, jeśli chcesz potwierdzić, że to
   właściwe.
3. **Wybierz co ma się stać przy trafieniu.** Zostaw jako samo powiadomienie, albo
   włącz **TRAVEL**, żeby automatycznie skoczyć do hideoutu sprzedawcy w momencie
   trafienia.
4. **Graj.** Gdy coś wpadnie, dostajesz dźwięk + powiadomienie (a jeśli TRAVEL
   jest włączony — jesteś już w jego hideoutcie). Sfinalizuj transakcję w grze.
5. Obserwuj tyle wyszukiwań ile chcesz; **wstrzymuj** te, których teraz nie
   potrzebujesz, bez utraty ich historii.

To wszystko. Aplikacja utrzymuje połączenia WebSocket w tle, kiedy grasz.

---

## FAQ

**Czy dostanę bana?**
To narzędzie nieoficjalne — używasz na własne ryzyko. Rozmawia z _tym samym_
trade API, którego już używa Twoja przeglądarka, trzyma się zachowawczych limitów
zapytań i **nigdy nie automatyzuje rozgrywki** (żadnego auto-kupowania, botowania
ani skryptów ruchu — prosi tylko o przeniesienie do hideoutu, dokładnie jak
kliknięcie przycisku na stronie trade). Mimo to GGG nie błogosławi narzędzi trade
od osób trzecich, więc traktuj je jak każdy nieoficjalny dodatek i nie szalej.
Wbudowany hamulec bezpieczeństwa istnieje właśnie po to, żeby utrzymać rozsądne
tempo zapytań.

**Czy kupuje za mnie przedmioty?**
Nie. Wykrywa ofertę i przenosi Cię do hideoutu. Transakcję finalizujesz **Ty**,
ręcznie. To celownik snajpera, nie spust.

**Czy muszę podać mu hasło?**
Nie. Logowanie odbywa się w prawdziwej przeglądarce na oficjalnej stronie Path of
Exile. Aplikacja przechwytuje tylko wynikowe ciasteczko sesji i szyfruje je w
keychainie systemu.

**Gdzie trafiają moje dane?**
Donikąd. Wszystko jest lokalne. Jedyny serwer, z którym się kiedykolwiek łączy,
to pathofexile.com. Opcjonalny log diagnostyczny zapisuje się do lokalnego pliku
i jest zredagowany — nigdy nie zawiera Twojego ciasteczka ani tokenu.

**Jak działają aktualizacje?**
Gdy pojawi się nowa wersja, aplikacja pokaże baner „dostępna nowa wersja", który
otwiera pobieranie w Twojej przeglądarce. Aktualizacje są ręczne (żadnej cichej
auto-instalacji), więc nic nie zmienia się bez Twojej zgody.

**Nie otwiera się / pisze, że jest uszkodzona.**
To ostrzeżenie o niepodpisanym buildzie — zobacz obejście w [Instalacji](#instalacja).

**Z której ligi korzysta?**
Z tej, którą wybierzesz / na którą wskazuje URL wyszukiwania. Domyślnie Standard.

---

## Development

To monorepo pnpm: jeden rdzeń NestJS, dwie powłoki (lokalne UI web + desktop
Electron).

```bash
nvm use            # Node 22
pnpm install
cp .env.example .env
pnpm dev           # server + web (UI w przeglądarce na dev serwerze Vite)
pnpm verify        # lint + typecheck + test
```

Powłoka desktopowa:

```bash
pnpm --filter @poe-sniper/desktop dev       # Electron wskazujący na dev serwer
pnpm --filter @poe-sniper/desktop dist      # lokalny build macOS .dmg
```

### Co gdzie leży

- `apps/server` — rdzeń snajpera NestJS (silniki detekcji, adapter trade API,
  governor limitów, travel, log sieciowy, sprawdzanie aktualizacji)
- `apps/web` — operatorskie UI w React (i18n, strumień SSE na żywo, historia trafień)
- `apps/desktop` — powłoka Electron (osadza serwer w procesie po loopbacku)
- `packages/shared` — kanoniczne typy domenowe
- `docs/` — jak ten projekt jest zbudowany; zacznij od [docs/README.md](docs/README.md)

Trade API GGG jest nieudokumentowane — przeczytaj `docs/integration/api-notes.md`
zanim ruszysz cokolwiek, co rozmawia z pathofexile.com.

### Wydawanie wersji

Tag gita jest jedynym źródłem prawdy o wersji.

```bash
# 1. Przenieś [Unreleased] → [x.y.z] w CHANGELOG.md i zacommituj.
# 2. Otaguj i wypchnij tag:
git tag v0.1.0
git push origin v0.1.0
```

Wypchnięcie taga `v*` uruchamia `.github/workflows/release.yml`, który buduje
instalatory Windows / macOS / Linux na natywnych runnerach i wrzuca je do
**szkicu** (draft) GitHub Release. Przejrzyj szkic, potem kliknij **Publish** —
dopiero wtedy in-app update check pokaże wersję użytkownikom.

---

> Niezwiązane z ani niewspierane przez Grinding Gear Games. „Path of Exile" jest
> znakiem towarowym Grinding Gear Games. Używaj odpowiedzialnie i na własne ryzyko.
