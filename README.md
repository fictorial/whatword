# WhatWord

https://whatword.wtf

- Be the first to guess a secret word within 2 minutes and 6 guesses
- Calm, non-competitive multiplayer
- Each letter is colored based on comparison to the same position in the current secret word
  - green: exact match
  - yellow: guessed letter present but not in given position
  - dark: guessed letter is not in the secret word

![screenshot](public/screenshot.png)

## Background

Clearly based on the most popular word game of 2022.

## What's not here

- Ads
- Tracking
- Social Media
- Accounts/authentication with Big Corp(tm)

It's just a simple word game for when you are bored or want to play
along with family, friends, or strangers.

## Tech

Backend:

- Digital Ocean (VPS/Droplet; Dokku)
- Node.js; Express
- Server Sent Events (SSE)

Frontend:

- HTML5
- CSS; "Responsive"
- "Vanilla" JavaScript
- EventSource (SSE)

Database:

- None; signed HTTP-only cookie stores player ID and name

## License

UNLICENSED

### What?

Basically, I'm using this as a mini-portfolio piece in case future employers are
curious what some of my "full stack" work might look like.

By all means learn from it if there happens to be something new to you. But, don't
put a copy online and claim it as your own. That's not cool.
