import fs from "node:fs"
import express from "express"
import cookieParser from "cookie-parser"
import ms from "ms"
import { nanoid } from "nanoid"
import LRU from "lru-cache"
import _debug from "debug"
import rateLimit from "express-rate-limit"

const debug = _debug("whatword")
const words = JSON.parse(fs.readFileSync("etc/words.json"))
const cookieName = "player"
const noMatch = "n"
const exactMatch = "e"
const shiftMatch = "s"
const exactMatchWord = "eeeee"
const gameDuration = ms(process.env.GAME_DURATION ?? "2 minutes")
const intermissionDuration = ms(process.env.INTERMISSION_DURATION ?? "15 seconds")
const upgradePendingPath = process.env.UPGRADE_PENDING_PATH ?? "/tmp/.upgrade-pending"

let gameID
let gameStartedAt
let secretWord
let reverseIndex // { $letter: [$index] }
let guessesPerPlayer // { $playerID: [{ guess, score }] }

let wordIndex = 0
let guessedWordCount = 0
let clients = []

let isProduction = process.env.NODE_ENV === "production"

const app = express()
app.set("view engine", "ejs")
app.set("trust proxy", isProduction)
app.use(express.static("public"))
app.use(cookieParser(process.env.SECRET ?? "bw9wOnRQve57-38i_MH5k"))
app.use(express.json())

app.use(function decodeOrCreatePlayer(req, res, next) {
  try {
    res.locals.player = JSON.parse(req.signedCookies[cookieName])
  } catch {
    res.locals.player = { id: nanoid(), name: makePlayerName() }
  } finally {
    next()
  }
})

function writeCookie(req, res) {
  res.cookie(cookieName, JSON.stringify(res.locals.player), {
    sameSite: "lax",
    secure: isProduction,
    signed: true,
    maxAge: ms("1 year"),
    httpOnly: true,
  })
}

class GameError extends Error {
  constructor(message) {
    super(message)
    this.name = "GameError"
    Error.captureStackTrace(this, GameError)
  }
}

app.post(
  "/guesses",
  rateLimit({ windowMs: 1000, max: 1, standardHeaders: false }),
  function onGuessMade(req, res) {
    if (!gameID) throw new GameError(`No game is active at the moment`)

    const guess = (req.body.guess || "").trim()
    if (!guess.match(/^[A-Z]{5}$/)) throw new GameError(`invalid format for guess`)
    if (words.indexOf(guess) === -1) throw new GameError(`${guess} is not in the word list`)

    const player = res.locals.player

    const selfGuesses = guessesPerPlayer[player.id] ?? []
    if (selfGuesses.length === 6) throw new GameError(`You are out of guesses for this game`)

    if (player.expertMode) checkExpertModeSatisfied(guess, selfGuesses)

    let score = [noMatch, noMatch, noMatch, noMatch, noMatch]
    let wordIndex = structuredClone(reverseIndex)

    // First pass is for exact matches. Follows that other really
    // popular word game of 2022 ;)

    for (let i = 0; i < 5; ++i) {
      const Gi = guess[i]
      const Si = secretWord[i]
      if (Gi === Si) {
        score[i] = exactMatch
        wordIndex[Gi].splice(wordIndex[Gi].indexOf(i), 1)
      }
    }

    for (let i = 0; i < 5; ++i) {
      const Gi = guess[i]
      if (score[i] !== exactMatch && wordIndex[Gi]?.length > 0) {
        score[i] = shiftMatch
        wordIndex[Gi].splice(wordIndex[Gi].indexOf(i), 1)
      }
    }

    score = score.join("")

    selfGuesses.push({ guess, score })
    guessesPerPlayer[player.id] = selfGuesses

    broadcast("guess", {
      gameID,
      player,
      score,
      guessNumber: selfGuesses.length - 1,
    })

    if (score === exactMatchWord) ++guessedWordCount

    res.send({ score })
  }
)

// In expert mode, the player has to use in the current guess the letters that
// were found in the secret word in any previous guess (of the same game).

function checkExpertModeSatisfied(guess, selfGuesses) {
  if (selfGuesses.length === 0) return

  const requiredLetters = new Set()
  for (let { guess, score } of selfGuesses) {
    for (let letterNumber = 0; letterNumber < 5; ++letterNumber) {
      const letterScore = score.charAt(letterNumber)
      if (letterScore === exactMatch || letterScore === shiftMatch)
        requiredLetters.add(guess.charAt(letterNumber))
    }
  }

  const mostRecentGuessLetters = new Set(guess)
  for (let requiredLetter of requiredLetters)
    if (!mostRecentGuessLetters.has(requiredLetter))
      throw new GameError(`Letter ${requiredLetter} required (Expert Mode)`)
}

app.get("/", (req, res) => {
  writeCookie(req, res)
  res.render("index")
})

const sseHeaders = {
  Connection: "keep-alive",
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no",
}

app.get("/events", (req, res) => {
  const player = res.locals.player

  res.writeHead(200, sseHeaders)
  clients.push(res) // this player gets own presence message, yes.
  broadcast("presence", { player, present: true, playerCount: clients.length })

  req.on("close", () => {
    clients = clients.filter((c) => c !== res)

    broadcast("presence", {
      player,
      present: false,
      playerCount: clients.length,
    })
  })

  res.write(
    formatEvent(
      "gameStart",
      Object.assign(gameStartPayload(), {
        selfGuesses: guessesPerPlayer[player.id] ?? [],
      })
    )
  )
})

function shuffle(a) {
  for (let n = a.length, x = n - 1; x > 0; x--) {
    const y = Math.floor(Math.random() * x)
    const t = a[x]
    a[x] = a[y]
    a[y] = t
  }
}

const formatEvent = (event, data) => `data: ${JSON.stringify({ event, data })}\n\n`

function broadcast(event, data) {
  const payload = formatEvent(event, data)
  debug("broadcast", payload)
  for (let client of clients) client.write(payload)
}

function secondsRemaining() {
  return gameDuration - (+Date.now() - gameStartedAt)
}

function gameStartPayload() {
  return {
    gameID,
    playerCount: clients.length,
    timeRemaining: secondsRemaining(),
    gameDuration,
  }
}

function resetState() {
  gameID = nanoid()
  gameStartedAt = +Date.now()
  guessesPerPlayer = {}
  guessedWordCount = 0
}

function start() {
  checkUpgrade()

  resetState()

  debug("start game", gameID, gameStartedAt)

  if (wordIndex % words.length === 0) shuffle(words)

  secretWord = words[wordIndex % words.length]
  debug("selected word for game %s: %s", secretWord, gameID)

  reverseIndex = {}
  for (let i = 0; i < 5; ++i) {
    const letter = secretWord[i]
    if (!reverseIndex[letter]) reverseIndex[letter] = [i]
    else reverseIndex[letter].push(i)
  }

  broadcast("gameStart", gameStartPayload())
  setTimeout(endCurrentGame, gameDuration)
}

function endCurrentGame() {
  debug("end game", gameID)

  broadcast("gameEnd", {
    gameID,
    secretWord,
    interGameDelay: intermissionDuration,
    guessedWordCount,
  })

  gameID = null
  wordIndex++

  setTimeout(start, intermissionDuration)
}

app.post(
  "/settings",
  rateLimit({ windowMs: 1000, max: 1, standardHeaders: false }),
  function onUpdateSettings(req, res) {
    let dirty = false

    const name = (req.body.name || "").trim().slice(0, 32)
    if (name.length >= 3) {
      dirty = true
      res.locals.player.name = name
      broadcast("nameChange", { player: res.locals.player, name })
    }

    const enableExpertMode = req.body.expertMode === true
    dirty = dirty || enableExpertMode !== res.locals.player.expertMode
    res.locals.player.expertMode = enableExpertMode

    if (dirty) writeCookie(req, res)
    res.send({})
  }
)

// Player names are non-unique but try not to repeat recently used names.

const playerNamesCount = 1000
const recentPlayerNames = new LRU({ max: playerNamesCount })
const adjectives = JSON.parse(fs.readFileSync("etc/adjectives.json"))
const nouns = JSON.parse(fs.readFileSync("etc/nouns.json"))
const randomElement = (a) => a[(Math.random() * a.length) | 0]
const generateUsername = () => `${randomElement(adjectives)}-${randomElement(nouns)}`

function makePlayerName() {
  for (let i = 0; i < playerNamesCount; ++i) {
    const name = generateUsername()
    if (!recentPlayerNames.has(name)) {
      recentPlayerNames.set(name, 1)
      return name
    }
  }
  return generateUsername()
}

app.get(
  "/names",
  rateLimit({ windowMs: 1000, max: 4, standardHeaders: false }),
  function onSuggestName(_, res) {
    res.send({ name: makePlayerName() })
  }
)

app.get("/ping", (_, res) => {
  const message = "pong"
  res.writeHead(200, {
    "Content-Type": "text/plain",
    "Content-Length": message.length,
  })
  res.write(message)
  res.end()
})

app.get("/version", (_, res) => {
  const packageInfo = JSON.parse(fs.readFileSync("package.json"), { encoding: "utf8" })
  res.writeHead(200, {
    "Content-Type": "text/plain",
    "Content-Length": packageInfo.version.length,
  })
  res.write(packageInfo.version)
  res.end()
})

app.use((err, _, res, next) => {
  if (err instanceof GameError) {
    console.error(
      "GameError",
      JSON.stringify({
        player: res.locals.player.id,
        game: gameID,
        error: err.message,
      })
    )
  } else {
    console.error(err.stack)
  }

  res.send({ error: err.message })
  next()
})

app.listen(process.env.PORT, (err) => {
  if (err) throw err

  debug("words:", words.length)
  debug("port:", process.env.PORT)

  start()
})

function checkUpgrade() {
  console.log("checking for upgrade", upgradePendingPath, fs.existsSync(upgradePendingPath))

  if (fs.existsSync(upgradePendingPath)) {
    console.warn("exiting since upgrade pending!")

    fs.unlinkSync(upgradePendingPath)
    process.exit(0)
  }
}
