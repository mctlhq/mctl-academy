# Privacy

mctl Academy is a free study tool. It collects the minimum needed to remember
your progress, and nothing else.

## What is stored

| Data | Why | Source |
|---|---|---|
| GitHub numeric user id | Stable identifier for your account | GitHub OAuth |
| GitHub login (username) | Shown in the interface so you know who you are signed in as | GitHub OAuth |
| Your attempts and answers | Progress tracking, Review-mistakes, and the dashboard | Your use of the app |
| Question reports you file | So a reported question can be fixed | Your use of the app |

That is the complete list.

## What is not stored

- **No email address.** The OAuth scope requested is `read:user`; the email
  scope is not requested, so the application never receives one.
- **No analytics, no tracking pixels, no third-party scripts.** There is no
  analytics provider at MVP.
- **No advertising identifiers**, and no data is sold or shared with anyone.
- **No password.** Authentication is GitHub OAuth only; this application never
  sees a credential.

## Sessions

Sessions are held in a secure, `HttpOnly`, `SameSite` cookie. The cookie carries
a session identifier, not your data. Sessions rotate on login and expire on
their own.

## Deleting your account

Account deletion is available in the application and takes effect immediately.
It removes your user record, every attempt and answer, and any reports you
filed, by cascade. Nothing is retained in a shadow copy.

Deleting your account does not delete the published questions themselves — those
are project content, not personal data.

## Where the data lives

PostgreSQL on the mctl platform, hosted in Germany (Hetzner). Backups go to
Cloudflare R2.

## Public repository

The application's source code and its entire question bank are public in this
repository. Your attempts are not — those live only in the application database
and are visible only to you.

## Contact

Open an issue in this repository, or email the address in the repository's
`SECURITY.md` for anything you would rather not discuss in public.
