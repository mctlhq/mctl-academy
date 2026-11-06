# Privacy

mctl Academy is a free study tool. It stores what it needs to remember your
progress, and it counts page views. This page lists both.

## What is stored

| Data | Why | Source | Retention |
|---|---|---|---|
| Your email address | Required by the account system (better-auth); this application itself never emails you or displays it | GitHub or Google OAuth, or MCTL's ZITADEL sign-in where offered | Until account deletion |
| GitHub login (username), if you sign in with GitHub | Shown in the interface so you know who you are signed in as | GitHub OAuth | Until account deletion |
| Your name and profile image, as provided by the sign-in provider | Shown in the interface | GitHub or Google OAuth | Until account deletion |
| Your name, if you sign in with ZITADEL (no profile image; a name that is an e-mail address is replaced by "Learner") | Shown in the interface | MCTL's ZITADEL sign-in, where offered | Until account deletion |
| Your ZITADEL user id, if you sign in with ZITADEL | Identifies your account; the e-mail address is never used for that | ZITADEL (OpenID Connect) | Until account deletion |
| Your attempts and answers | Progress tracking, Review-mistakes, and the dashboard | Your use of the app | Until account deletion |
| Question reports you file | So a reported question can be fixed | Your use of the app | Until account deletion (anonymous reports are kept) |
| Your +1/-1 vote on a question, if you cast one | Surfacing a per-question quality signal to other learners as a net score | Your use of the app | Until account deletion |
| Page view telemetry: page address, referrer, browser, operating system, device type, screen size, language, and country, region and city derived from the IP address | Counting visits via platform-hosted Umami at `stats.mctl.ai` (cookieless; the visitor identifier is computed from the IP address and browser details with a salt that rotates monthly; the IP address itself is not stored) | Browser page loads | 2 years |

That is the complete list of data this application and its analytics store.

## Analytics & Tracking

- **Cookieless visit telemetry.** Page views are measured using the platform's self-hosted Umami deployment at `https://stats.mctl.ai`. Umami computes a visitor identifier from the IP address and browser details with a salt that rotates monthly, and stores that identifier with the fields listed above. It does not store the IP address itself. A platform retention job deletes telemetry older than 2 years.
- **No third-party trackers, pixels, or ad networks.** No commercial analytics (Google Analytics, Meta, etc.) are used, and no data is sold.
- **Services your browser and this application do reach.** Traffic to the site passes through Cloudflare. Pages load fonts from Google Fonts, so Google receives your IP address when it serves them. A profile image is loaded from GitHub or Google, whichever you signed in with. Sign-in goes through the provider you choose. Database backups go to Cloudflare R2.
- **No password.** Authentication is GitHub or Google OAuth, or MCTL's
  ZITADEL sign-in where offered; this application never sees or stores a
  credential.
- **OAuth access and refresh tokens are encrypted at rest** and are never used
  to call the GitHub or Google API again after sign-in completes.
- **No account IP address or User-Agent persisted by application.** The account system this application runs on
  (better-auth) captures both by default on every sign-in; this application
  explicitly discards them before they are written to the database, since it
  has no feature (no security dashboard, no "sign out other devices") that
  needs them.

## A note on email

Earlier versions of this document said no email address was collected. That
was true only while sign-in was hand-rolled and requested the minimal `read:user`
GitHub scope. The account system this application now runs on (better-auth)
requires an email address as part of its own data model regardless of
provider, and both GitHub and Google return one during sign-in. This
application does not send you email and does not display your address to
other users — it exists in the database as an account field, nothing more.

## Sessions

Sessions are held in a secure, `HttpOnly`, `SameSite` cookie. The cookie carries
a signed session identifier, not your data. Each sign-in creates a new session;
sessions expire automatically and are revoked immediately on sign-out or
account deletion.

## Deleting your account

Account deletion is available in the application and takes effect immediately.
It removes your user record, every attempt and answer, any reports, and any
question votes stored in the Academy database, by cascade. Database backups keep
that data until they expire, after about 14 days.

Question feedback that you choose to publish as a GitHub issue is managed by
your GitHub account, not by your Academy account. Deleting your Academy account
does not delete those GitHub issues. You can edit or close them through GitHub;
to request permanent deletion, comment on the issue and ask the repository
maintainers to remove it.

Deleting your account does not delete the published questions themselves — those
are project content, not personal data.

## Where the data lives

PostgreSQL on the mctl platform, hosted in Germany (Hetzner). Backups go to
Cloudflare R2 and are kept for about 14 days.

## Public repository

The application's source code and its entire question bank are public in this
repository. Your attempts are not — those live only in the application database
and are visible only to you.

## Contact

Open an issue in this repository. If your request concerns an existing issue,
comment there so the maintainers can verify its context.
