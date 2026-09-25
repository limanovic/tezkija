# Play Store Listing — Tezkija

Default listing language: **Bosnian (bs)**. Add **English (en-US)** as a
second listing language with the texts below. Play lets the app name differ
per language; it's the same here.

## App name (30 chars max)

Tezkija

## Short description (80 chars max)

**bs:** Ajeti Kur’ana o ponašanju, svaki dan — redom ili nasumično. Potpuno offline.

**en:** The Qur’an’s ayahs on conduct, every day — in order or at random. Fully offline.

## Full description (4000 chars max)

Play accepts a small HTML subset (`<b>`, `<i>`, `<br>`) — see
`full-description.bs.txt` and `full-description.en.txt` for paste-ready copies.

### bs

Tezkija (تزكية) — čišćenje duše da bi rasla.

Kur’an sadrži 340 ajeta koji jasno i nedvosmisleno govore kako čovjek treba da se ponaša: prema Allahu, prema ljudima, prema sebi. Tezkija ti ih donosi svaki dan, u vrijeme koje sam odabereš, kao obavještenje na telefonu. Dodirneš ga — i otvori se tačno taj ajet, na arapskom i u prijevodu.

Nije cijeli Kur’an. Samo ajeti koje treba primijeniti u životu.

**Kako radi**

Postaviš jedno ili više vremena u danu. Za svako biraš koliko ajeta stiže (1–10) i kako:

• **Redom** — uzima sljedeće ajete po redu, od 2:42 do 114:1, nastavljajući tamo gdje si stao. Poslije posljednjeg počinje ponovo od prvog.
• **Nasumično** — svaki put drugi ajeti.

Sva vremena postavljena na Redom dijele jedno čitanje: jutro donosi sljedeći ajet, podne onaj poslije njega, večer sljedeći — jedan prolaz kroz svih 340, raspoređen kroz dan. Vrijeme postavljeno na Nasumično stoji izvan tog toka i ne pomjera ga.

**Šta je unutra**

• 340 ajeta o ponašanju, iz 71 sure, u redoslijedu mushafa
• 106 ajeta izvorno upućenih Poslaniku ﷺ, a čija uputa vrijedi za sve, označeno posebnom oznakom
• Arapski tekst u pismu Medinskog mushafa (Uthmani)
• Prijevod: Muhamed Mehanović (bosanski), Sahih International (engleski)
• Cijeli popis za čitanje, grupisan po surama, s pregledom sura
• Zabilješke i povratak na mjesto gdje si stao
• Podesiva veličina teksta, svijetla i tamna tema
• Aplikacija na bosanskom ili engleskom

**Šta je izostavljeno**

Ratne i historijske naredbe zajednici, kazne koje izvršava vlast, propisi vezani samo za Poslanikovu osobu, propisi iz doba ropstva, derogirani ajeti, nasljedna aritmetika i pravna procedura, te ajeti koji sadrže samo „vjerujte“ ili „bojte se Allaha“ bez konkretnog ponašanja.

**Potpuno privatno**

• 100% offline — internet nije potreban, nikad
• Bez računa, bez registracije
• Bez reklama, bez analitike, bez praćenja
• Besplatno

Sve je u aplikaciji, u lokalnoj bazi. Ništa se ne preuzima, ništa se ne šalje. Tvoje postavke, zabilješke i napredak ostaju na tvom uređaju.

Uskoro: lekcije arapskog za razumijevanje Kur’ana — riječi po učestalosti, s ajetima u kojima se pojavljuju.

### en

Tezkija (تزكية) — purifying the self so it grows.

The Qur’an has 340 ayahs that say plainly and unambiguously how a person should act: towards God, towards people, towards themselves. Tezkija brings them to you every day, at the times you choose, as a notification on your phone. Tap it, and exactly that ayah opens — in Arabic and in translation.

Not the whole Qur’an. Only the ayahs to put into practice.

**How it works**

Set one or more daily times. For each, choose how many ayahs arrive (1–10) and how:

• **In order** — takes the next ayahs in sequence, from 2:42 to 114:1, continuing from wherever you stopped. After the last it begins again at the first.
• **Random** — different ayahs every time.

All times set to In order share one reading: morning brings the next ayah, midday the one after, evening the next — one pass through all 340, spread across the day. A time set to Random sits outside that progression and never moves it.

**What’s inside**

• 340 ayahs on conduct, from 71 surahs, in mushaf order
• 106 ayahs originally addressed to the Prophet ﷺ whose guidance applies to everyone, marked with a badge
• Arabic text in the script of the Madani mushaf (Uthmani)
• Translations: Sahih International (English), Muhamed Mehanović (Bosnian)
• The full list for reading, grouped by surah, with a surah index
• Bookmarks, and one tap back to where you stopped
• Adjustable text size, light and dark themes
• App interface in English or Bosnian

**What’s left out**

Wartime and historical commands to the community, punishments carried out by the state, rules specific to the Prophet’s person, rules from the era of slavery, abrogated ayahs, inheritance arithmetic and legal procedure, and ayahs that say only “believe” or “fear God” without a concrete action.

**Completely private**

• 100% offline — no internet connection needed, ever
• No account, no sign-up
• No ads, no analytics, no tracking
• Free

Everything is bundled in a local database. Nothing is downloaded, nothing is sent anywhere. Your settings, bookmarks and progress stay on your device.

Coming: Arabic lessons for understanding the Qur’an — words by frequency, with the ayahs they appear in.

## Category

Books & Reference (alternative: Lifestyle)

## Tags / keywords (for ASO, not a console field)

kuran, kur'an, quran, ajeti, ponašanje, ahlak, islam, muslim, offline, tezkija, daily ayah, conduct, bosanski

## Contact email

office@adiv.dev

## Privacy policy URL

https://limanovic.github.io/tezkija/privacy/

Served by GitHub Pages from `docs/` on `main` (repo is public). Edit
`docs/privacy/index.html` and push to update.

## Graphics checklist

Generated into `store/graphics/` — see the README there. Regenerate with
`store/graphics/render.sh`.

- [x] App icon 512×512 PNG, no alpha — `graphics/play-icon-512.png`
- [x] Feature graphic 1024×500 — `graphics/feature-graphic-1024x500.png`
- [x] In-app icon matches the Play icon — the rosette shipped in `assets/images/`
- [x] Phone screenshots — `graphics/screenshots/`, captured on a Pixel 7 Pro
      API 34 emulator (1440×3120), status bar left in place
- [ ] Optional: 7" and 10" tablet screenshots

## Permissions to explain, if asked

`SCHEDULE_EXACT_ALARM` — used only to make a reminder arrive at the minute the
user set. Not the policy-restricted `USE_EXACT_ALARM`; the app works without the
grant, the reminder simply arrives batched a few minutes late.

## Data safety form answers

- Does your app collect or share any of the required user data types? → **No**
- Is all of the user data collected by your app encrypted in transit? → N/A (no data collected)
- Do you provide a way for users to request that their data is deleted? → N/A

## Content rating questionnaire notes

- Category: Reference/Educational content
- No violence, sexuality, profanity, gambling, drugs
- Contains religious content — answer honestly; results in Everyone/PEGI 3 rating

## Release track

Start on **Internal testing** (up to 100 testers by email, no review wait),
then promote to Production. Play requires a closed test with 12+ testers for
14 days before production for accounts created after Nov 2023 — check whether
the developer account is affected.
