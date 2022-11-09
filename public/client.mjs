const $ = document.querySelector.bind(document)
const $$ = document.querySelectorAll.bind(document)

const $showSettings = $('a[href="#settings"]')
const $settings = $("#settings")
const $settingsForm = $("#settings > div")
const $expertToggle = $("#settings #expert-mode")
const $playerNameInput = $("#settings #player-name")
const $suggestName = $("#settings #suggest-name")
const $countdownWrapper = $("#countdown")
const $countdownBar = $("#countdown .bar")
const $eventLabel = $("#event-label")
const $messageLabel = $("#message")
const $localGuessesWrapper = $("#local-guesses-wrapper")
const $localGuesses = $("#local-guesses")
const $allGuesses = $("#all-guesses")
const $keyboard = $("#keyboard")

let gameID
let gameDuration
let localGuessLetters = []
let localGuessNumber = 0
let localPlayerGuessedWord = false
let clearEventLabelTimeout
let clearMessageLabelTimeout
let countdownTimeout

const noMatch = "n"
const shiftMatch = "s"
const exactMatch = "e"
const exactMatchWord = "eeeee"
const exactMatchCountRegex = new RegExp(exactMatch, "g")
const exactMatchClass = "exact-match"
const noMatchClass = "no-match"
const shiftMatchClass = "shift-match"
const classForScore = {
  [exactMatch]: exactMatchClass,
  [noMatch]: noMatchClass,
  [shiftMatch]: shiftMatchClass,
}

const foundWordMessages = ["You got it!", "Yes!", "Yeah!", "Awesome!", "Great!"]
const sorryMessages = ["Nice try!", "Good effort!", "Next time!", "Aww, too bad!"]

const headersJSON = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
}

const randomElement = (a) => a[(Math.random() * a.length) | 0]

const addClass = ($el, ...args) => $el.classList.add(...args)
const hasClass = ($el, cls) => $el.classList.contains(cls)
const rmClass = ($el, ...args) => $el.classList.remove(...args)
const reAddClass = ($el, ...args) => {
  rmClass($el, ...args)
  addClass($el, ...args)
}

async function animate($el, animationName) {
  return new Promise((resolve) => {
    reAddClass($el, animationName)
    $el.addEventListener("animationend", resolve, { once: true })
  })
}

const fadeClasses = [
  "fade-in",
  "fade-out",
  "fade-in-up",
  "fade-in-down",
  "fade-out-up",
  "fade-out-down",
]
const clearFades = ($el) => rmClass($el, ...fadeClasses)
const fade = async ($el, animationName) => {
  clearFades($el)
  return await animate($el, animationName)
}
const fadeIn = ($el) => fade($el, "fade-in")
const fadeOut = ($el) => fade($el, "fade-out")
const fadeInDown = ($el) => fade($el, "fade-in-down")
const fadeInUp = ($el) => fade($el, "fade-in-up")
const fadeOutDown = ($el) => fade($el, "fade-out-down")
const fadeOutUp = ($el) => fade($el, "fade-out-up")

async function fetchJSON({ path, data, method }) {
  const body = data !== undefined ? JSON.stringify(data) : null
  const response = await fetch(path, {
    method: method ?? "POST",
    headers: headersJSON,
    body,
  })
  return await response.json()
}

const postJSON = async (path, data) => await fetchJSON({ path, data, method: "POST" })
const getJSON = async (path) => await fetchJSON({ path, method: "GET" })

async function showMessage(text, automaticallyClear = true) {
  $messageLabel.textContent = text
  $messageLabel.style.visibility = "visible"
  await fadeIn($messageLabel)

  if (automaticallyClear) {
    clearTimeout(clearMessageLabelTimeout)
    clearMessageLabelTimeout = setTimeout(async () => {
      await fadeOut($messageLabel)
      $messageLabel.textContent = null
      $messageLabel.style.visibility = "hidden"
    }, 600 * text.length)
  }
}

async function showEvent(label, automaticallyClear = true) {
  $eventLabel.textContent = label
  await fadeInDown($eventLabel)
  if (automaticallyClear) {
    clearTimeout(clearEventLabelTimeout)
    clearEventLabelTimeout = setTimeout(async () => {
      if ($eventLabel.textContent === label) await hideEventLabel()
    }, 400 * label.length)
  }
}

async function hideEventLabel() {
  await fadeOutUp($eventLabel)
  $eventLabel.textContent = null
}

function setExpertModeLabel() {
  $expertToggle.textContent = window.player.expertMode ? "Disable" : "Enable"
}

$expertToggle.addEventListener("click", function (event) {
  event.stopPropagation()
  event.preventDefault()

  window.player.expertMode = !window.player.expertMode
  setExpertModeLabel()
})

setExpertModeLabel()

$showSettings.addEventListener("click", async function (event) {
  $settings.style.display = "flex"

  event.stopPropagation()
  event.preventDefault()

  await Promise.all([
    fadeIn($settings),
    fadeInUp($settingsForm),
    fadeOutDown($localGuessesWrapper),
    fadeOutDown($keyboard),
  ])
})

$suggestName.addEventListener("click", async function (event) {
  event.stopPropagation()
  event.preventDefault()

  const { name } = await getJSON("/names")
  $playerNameInput.value = name
})

$playerNameInput.addEventListener("keyup", async (event) => {
  if (event.key.toUpperCase() === "ENTER") await commitSettings()
  event.preventDefault()
  event.stopPropagation()
})

async function commitSettings() {
  const name = ($playerNameInput.value || "").trim()
  if (name.length < 3) {
    $playerNameInput.focus()
    reAddClass($playerNameInput, "shake")
  } else {
    const expertMode = window.player.expertMode
    await postJSON("/settings", { name, expertMode })
    await closeSettings()
  }
}

async function closeSettings() {
  const anims = [fadeOutDown($settingsForm), fadeOut($settings)]
  if (gameID) anims.push(fadeInUp($localGuessesWrapper), fadeInUp($keyboard))
  await Promise.all(anims)

  $settings.style.display = "none"

  const $el = document.querySelector(":focus")
  if ($el) $el.blur()
  document.body.focus()
}

// The wrapper/backdrop...

$settings.addEventListener("click", function (event) {
  if (event.target === $settings) {
    event.stopPropagation()
    event.preventDefault()

    commitSettings()
  }
})

async function didPressKey(letter) {
  if (!gameID) return console.log("ignoring key press as game is inactive")

  if (letter === "BACKSPACE") localGuessLetters = localGuessLetters.slice(0, -1)
  else if (letter === "ENTER") {
    if (localGuessLetters.length === 5) await submitGuess()
    else maybeShowGuessesAre5LettersMessage()
  } else if (letter.match(/^[A-Z]$/)) localGuessLetters.push(letter)

  localGuessLetters = localGuessLetters.slice(0, 5)

  for (let letterNumber = 0; letterNumber < 5; ++letterNumber) {
    const letter = localGuessLetters[letterNumber]
    const $letter = getLocalGuessLetterElement(localGuessNumber, letterNumber)
    if ($letter) $letter.textContent = letter ?? " "
  }
}

function onKeyClick(event) {
  if (hasClass(event.target, "key")) {
    didPressKey(event.target.getAttribute("data-key"))

    event.stopPropagation()
    event.preventDefault()
  }
}

function onKeyUp(event) {
  const k = event.key.toUpperCase()
  if (k === "ESCAPE") closeSettings()
  else if (k === "ENTER" || k === "BACKSPACE" || k.match(/^[A-Z]$/)) didPressKey(k)
}

document.addEventListener("click", onKeyClick)
document.addEventListener("keyup", onKeyUp)

async function submitGuess() {
  const guess = localGuessLetters.join("")
  const result = await postJSON("/guesses", { guess })

  if (result.error) showMessage(result.error)
  else if (result.score === exactMatchWord) gameID = null
}

function getLocalGuessLetterElement(guessNumber, letterNumber) {
  if (guessNumber < 0 || guessNumber > 5) throw new Error("invalid guess number")
  if (letterNumber < 0 || letterNumber > 4) throw new Error("invalid letter number")
  return $(`#local-${guessNumber}${letterNumber}`)
}

function getKeyboardKey(forLetter) {
  return $(`.key[data-key="${forLetter}"]`)
}

function clearLocalGuessLetters() {
  for (let guessNumber = 0; guessNumber < 6; ++guessNumber) {
    for (let letterNumber = 0; letterNumber < 5; ++letterNumber) {
      const $letter = getLocalGuessLetterElement(guessNumber, letterNumber)
      if ($letter) $letter.textContent = " "
    }
  }
}

function rmScoreClasses($el) {
  clearFades($el)
  rmClass($el, exactMatchClass, shiftMatchClass, noMatchClass)
  return $el
}

function addScoreClasses($el, score, forceClassName) {
  rmScoreClasses($el)
  addClass($el, forceClassName ?? classForScore[score])
  return $el
}

function rmScoreDecorations() {
  $localGuesses.querySelectorAll("div").forEach(($letter) => {
    rmScoreClasses($letter)
    $letter.textContent = " "
  })

  document.querySelectorAll(".key").forEach(rmScoreClasses)
}

async function showPlayerCount(playerCount) {
  const noun = playerCount !== 1 ? "players" : "player"
  showMessage(`${playerCount.toLocaleString()} ${noun} online`)
}

// score here is all the letters of the guess scored e.g. "nnesn"

async function onGuess({ player, score, guessNumber }) {
  const exactMatchesFound = score.match(exactMatchCountRegex)?.length ?? 0

  if (player.id === window.player.id) {
    const guess = localGuessLetters.join("")
    await onLocalPlayerGuessScored(score, guess, guessNumber)
  } else if (exactMatchesFound > 0) {
    onRemotePlayerGuessScored(score)
  }

  let $container = playerGuessesContainer(player.id)
  if (!$container) addPlayerGuessesContainer(player)
  showPlayerGuessScore(player, score, guessNumber)
}

async function onLocalPlayerGuessScored(score, guess, guessNumber) {
  const exactMatchesFound = score.match(exactMatchCountRegex)?.length ?? 0
  const didGuessWord = exactMatchesFound === 5
  localPlayerGuessedWord = didGuessWord

  // Decorate the local guess letters with their letter scores.

  const overrideClassName = didGuessWord ? exactMatchClass : null
  for (let letterNumber = 0; letterNumber < 5; ++letterNumber) {
    const letterScore = score.charAt(letterNumber)
    addScoreClasses(
      getLocalGuessLetterElement(guessNumber, letterNumber),
      letterScore,
      overrideClassName
    )
  }

  // Decorate the keyboard keys based on this most recent guess.
  // It's a bit tricky in that there could be duplicate letters in the guess
  // but there's only one keyboard key for that letter.
  // We choose to decorate the keyboard key based on the "best" letter score
  // in such cases.

  const duplicateLetters = new Set()
  for (let i = 0; i < 5; ++i) {
    const Gi = guess.charAt(i)
    for (let j = 0; j < 5; ++j) {
      if (i === j) continue
      const Gj = guess.charAt(j)
      if (Gi === Gj) duplicateLetters.add(Gi)
    }
  }
  const letterScoreValues = {
    [noMatch]: 0,
    [shiftMatch]: 1,
    [exactMatch]: 2,
  }
  const bestLetterScores = new Map()
  for (let duplicateLetter of duplicateLetters) {
    let bestLetterScore = noMatch
    for (let i = 0; i < 5; ++i) {
      if (guess.charAt(i) === duplicateLetter) {
        const Si = score.charAt(i)
        if (letterScoreValues[Si] > letterScoreValues[bestLetterScore]) bestLetterScore = Si
      }
    }
    bestLetterScores.set(duplicateLetter, bestLetterScore)
  }
  for (let [letter, score] of bestLetterScores.entries())
    addScoreClasses(getKeyboardKey(letter), score)
  for (let i = 0; i < 5; ++i) {
    const Gi = guess.charAt(i)
    if (!duplicateLetters.has(Gi)) addScoreClasses(getKeyboardKey(Gi), score.charAt(i))
  }

  // Make it obvious that the local player got the secret word (or didn't).

  if (didGuessWord) {
    for (let letterNumber = 0; letterNumber < 5; ++letterNumber) {
      const $letter = getLocalGuessLetterElement(localGuessNumber, letterNumber)
      if ($letter) animate($letter, "flip")
    }

    showMessage(randomElement(foundWordMessages), false)
    showFireworks()
  } else if (localGuessNumber === 5) {
    showMessage(randomElement(sorryMessages), false)
  } else {
    localGuessNumber = guessNumber + 1
    localGuessLetters = []
  }
}

async function onRemotePlayerGuessScored(score) {
  const exactMatchesFound = score.match(exactMatchCountRegex)?.length ?? 0
  const didGuessWord = exactMatchesFound === 5

  if (didGuessWord) showMessage(`${player.name} found the word!`)
  else if (exactMatchesFound === 1) showMessage(`${player.name} found a letter`)
  else showMessage(`${player.name} found ${exactMatchesFound} letters`)
}

function showFireworks() {
  var duration = 5000
  var animationEnd = Date.now() + duration
  var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 }

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min
  }

  var interval = setInterval(function () {
    var timeLeft = animationEnd - Date.now()
    if (timeLeft <= 0) return clearInterval(interval)
    var particleCount = 50 * (timeLeft / duration)
    confetti(
      Object.assign({}, defaults, {
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      })
    )
    confetti(
      Object.assign({}, defaults, {
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      })
    )
  }, 250)
}

async function onGameStart({
  gameID: _gameID,
  gameDuration: _gameDuration,
  timeRemaining,
  playerCount,
  selfGuesses,
}) {
  //if ($settings.style.display === "flex") closeSettings()

  rmClass(document.body, "game-off")
  document.body.style.backgroundBlendMode = "difference"

  gameID = _gameID
  gameDuration = _gameDuration
  localPlayerGuessedWord = false
  localGuessLetters = []

  showPlayerCount(playerCount)
  rmScoreDecorations()

  // Assume it takes 500ms for the message to get to us from the server.
  startCountdownTimer(1000 * Math.round((timeRemaining - 500) / 1000), gameDuration)
  clearLocalGuessLetters()

  showMessage(gameID ? "Start guessing!" : "Waiting for next game to start...︎", false)
  if ($eventLabel.textContent) hideEventLabel()

  // `selfGuesses` is when a player joins a game already in progress.
  // E.g. they reload the page after making a number of guesses.

  selfGuesses = selfGuesses ?? []
  localGuessNumber = selfGuesses.length

  selfGuesses.forEach(async ({ guess, score }, guessNumber) => {
    onLocalPlayerGuessScored(score, guess, guessNumber)

    for (let letterNumber = 0; letterNumber < 5; ++letterNumber)
      getLocalGuessLetterElement(guessNumber, letterNumber).textContent = guess.charAt(letterNumber)

    showPlayerGuessScore(window.player, score, guessNumber)
  })

  if ($localGuessesWrapper.style.opacity !== 1) {
    await Promise.all([fadeInUp($localGuessesWrapper), fadeInUp($keyboard)])
  }
}

async function onGameEnd({ gameID: _gameID, secretWord, interGameDelay, guessedWordCount }) {
  //if ($settings.style.display === "flex") closeSettings()

  showMessage("Game Over")

  addClass(document.body, "game-off")

  gameID = null

  await Promise.all([fadeOutDown($localGuessesWrapper), fadeOutDown($keyboard)])

  // HELLO => H E L L O (can do this with CSS too of course)
  showEvent(secretWord.replace(/./g, "$& ").slice(0, -1), false)

  document.body.style.backgroundBlendMode = "color"

  // Assume it takes 500ms for the message to get to us from the server.
  const timeRemaining = 1000 * Math.round((interGameDelay - 500) / 1000)

  startCountdownTimer(timeRemaining, interGameDelay, (remainingTime) => {
    switch (Math.floor(remainingTime / 1000)) {
      case 10:
        showGuessedWordCountMessage(guessedWordCount)
        break
      case 8:
        hideEventLabel()
        rmScoreDecorations()
        clearPlayerGuessScores()
        break
      case 3:
        showMessage("Get Ready!")
        break
    }
  })
}

async function showGuessedWordCountMessage(guessedWordCount) {
  if (guessedWordCount === 0) showMessage("No one guessed the word!")
  else if (guessedWordCount === 1) {
    if (localPlayerGuessedWord) showMessage("You were the only player to guess the word!")
    else showMessage("Only one player guessed the word!")
  } else showMessage(`${guessedWordCount} players guessed the word`)
}

function onNameChange({ player, name }) {
  if (player.id === window.player.id) $playerNameInput.value = name
  const $name = $(`#all-guesses #${idForPlayerGuessesContainer(player.id)} .player-name`)
  $name.textContent = name
}

const idForPlayerGuessesContainer = (playerID) => `player-${playerID}`
const playerGuessesContainer = (playerID) =>
  $(`#all-guesses #${idForPlayerGuessesContainer(playerID)}`)

const playerGuessElement = (playerID, guessNumber, letterNumber) =>
  $(`#all-guesses #${idForPlayerGuessesContainer(playerID)} #guess-${guessNumber}${letterNumber}`)
const allPlayerGuessElements = () => $$(`#all-guesses .player-guesses > div`)

function addPlayerGuessesContainer(player) {
  const $container = document.createElement("div")
  $container.id = idForPlayerGuessesContainer(player.id)
  $container.className = "player-guesses"

  for (let guessNumber = 0; guessNumber < 6; ++guessNumber) {
    for (let letterNumber = 0; letterNumber < 5; ++letterNumber) {
      const $scoredLetter = document.createElement("div")
      $scoredLetter.id = `guess-${guessNumber}${letterNumber}`
      $container.appendChild($scoredLetter)
    }
  }

  const $nameLabel = document.createElement("div")
  $nameLabel.className = "player-name"
  $nameLabel.textContent = player.name
  $container.appendChild($nameLabel)

  $allGuesses.appendChild($container)
  return $container
}

function showPlayerGuessScore(player, score, guessNumber) {
  for (let letterNumber = 0; letterNumber < 5; ++letterNumber) {
    const $el = playerGuessElement(player.id, guessNumber, letterNumber)
    if ($el) {
      rmScoreClasses($el)
      addScoreClasses($el, score.charAt(letterNumber))
    }
  }
}

function clearPlayerGuessScores() {
  allPlayerGuessElements().forEach(rmScoreClasses)
}

async function onPresenceChange({ player, present, playerCount }) {
  if (player.id === window.player.id)
    showMessage(`${player.name} has ${present ? "joined" : "left"}`)

  let $container = playerGuessesContainer(player.id)
  if ($container) $container.parentNode.removeChild($container)
  if (present) addPlayerGuessesContainer(player)

  showPlayerCount(playerCount)
}

function startCountdownTimer(remainingTime, totalTime, hook) {
  $countdownBar.style.width = `100%`

  const updateTimeRemaining = () => {
    remainingTime = Math.max(0, remainingTime - 1000)
    $countdownBar.style.width = `${100 * (remainingTime / totalTime)}%`
    hook?.(remainingTime)
    clearTimeout(countdownTimeout)
    if (remainingTime > 0) countdownTimeout = setTimeout(updateTimeRemaining, 1000)
  }

  updateTimeRemaining()
}

const eventSourceHandlers = {
  gameStart: onGameStart,
  guess: onGuess,
  gameEnd: onGameEnd,
  nameChange: onNameChange,
  presence: onPresenceChange,
}

let eventSource

function closeEventSource() {
  eventSource.close()
}

function connectEventSource() {
  console.debug("connecting to event source...")
  eventSource = new EventSource("/events")

  eventSource.onopen = async (event) => {
    console.debug("connected to event source...")

    await Promise.all([
      fadeInUp($localGuessesWrapper),
      fadeInDown($countdownWrapper),
      fadeInUp($keyboard),
    ])

    window.addEventListener("beforeunload", closeEventSource)
  }

  eventSource.onerror = async (event) => {
    console.error("eventsource connection failed", event.error)

    window.removeEventListener("beforeunload", closeEventSource)

    await Promise.all([
      fadeOutDown($localGuessesWrapper),
      fadeOutUp($countdownWrapper),
      fadeOutDown($keyboard),
    ])

    setTimeout(async () => {
      await showEvent("Reconnecting... 🙃", false)
      location.reload()
    }, 500 + 800 * Math.random())
  }

  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data)
    console.debug("SSE", message)

    if (eventSourceHandlers.hasOwnProperty(message.event))
      eventSourceHandlers[message.event](message.data)
    else console.error("unexpected message", message)
  }
}

connectEventSource()

// Given that setTimeout etc are throttled, it's easiest to just resync on return.
// It's quite lightweight.

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    console.debug("reloading on returning to page from other app")
    location.reload()
  }
})

const seenDurationKey = "onetime-duration"

if (!localStorage.getItem(seenDurationKey)) {
  localStorage.setItem(seenDurationKey, "1")
  setTimeout(() => showMessage("New word every 2 minutes"), 2000)
}

const guessesAre5LettersKey = "onetime-guesses5"

function maybeShowGuessesAre5LettersMessage() {
  if (!localStorage.getItem(guessesAre5LettersKey)) {
    localStorage.setItem(guessesAre5LettersKey, "1")
    showMessage("Guesses are 5 letters")
  }
}
