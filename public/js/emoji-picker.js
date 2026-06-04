// WhatsApp-style emoji picker — a self-contained popover with a quick row of
// recently-used emojis and a full, searchable, categorized grid. Used both for
// reacting to chat messages and for inserting emojis into the composer.
//
// Public API (window.EmojiPicker):
//   open(anchorEl, { onPick, keepOpenOnPick, startExpanded })
//   close()
//   getRecent() / pushRecent(emoji)
(function () {
  'use strict';

  const RECENT_KEY = 'pronet_recent_emojis';
  const RECENT_MAX = 32;
  // WhatsApp's default reaction row, shown until the user builds up a history.
  const DEFAULT_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  // Curated set grouped by category. Each entry is [emoji, "search keywords"].
  const CATEGORIES = [
    {
      id: 'smileys', icon: '😀', name: 'Smileys & People', list: [
        ['😀', 'grin smile happy'], ['😃', 'happy joy smile'], ['😄', 'happy laugh'],
        ['😁', 'beam grin'], ['😆', 'laugh haha'], ['😅', 'sweat laugh nervous'],
        ['🤣', 'rofl laughing'], ['😂', 'joy tears laugh'], ['🙂', 'smile slight'],
        ['🙃', 'upside down silly'], ['😉', 'wink'], ['😊', 'blush happy smile'],
        ['😇', 'angel innocent'], ['🥰', 'love hearts adore'], ['😍', 'love heart eyes'],
        ['🤩', 'star struck wow'], ['😘', 'kiss blow'], ['😗', 'kiss'], ['😚', 'kiss'],
        ['😋', 'yum tasty'], ['😛', 'tongue'], ['😜', 'wink tongue silly'],
        ['🤪', 'zany crazy'], ['😝', 'tongue squint'], ['🤑', 'money mouth'],
        ['🤗', 'hug'], ['🤭', 'giggle oops'], ['🤫', 'shush quiet'], ['🤔', 'thinking hmm'],
        ['🤐', 'zipper quiet'], ['😐', 'neutral meh'], ['😑', 'expressionless'],
        ['😶', 'no mouth silent'], ['😏', 'smirk'], ['😒', 'unamused meh'],
        ['🙄', 'eye roll'], ['😬', 'grimace'], ['😮‍💨', 'exhale relieved'],
        ['😌', 'relieved calm'], ['😔', 'sad pensive'], ['😪', 'sleepy tired'],
        ['😴', 'sleep zzz'], ['😷', 'mask sick'], ['🤒', 'sick thermometer'],
        ['🤕', 'hurt bandage'], ['🤢', 'sick nausea'], ['🤮', 'vomit sick'],
        ['🥵', 'hot heat'], ['🥶', 'cold freezing'], ['🥴', 'woozy drunk'],
        ['😵', 'dizzy'], ['🤯', 'mind blown shock'], ['🤠', 'cowboy'],
        ['🥳', 'party celebrate'], ['😎', 'cool sunglasses'], ['🤓', 'nerd geek'],
        ['🧐', 'monocle inspect'], ['😕', 'confused'], ['😟', 'worried'],
        ['🙁', 'frown sad'], ['😮', 'wow surprised open mouth'], ['😯', 'hushed'],
        ['😲', 'astonished shock'], ['😳', 'flushed embarrassed'], ['🥺', 'pleading puppy'],
        ['😦', 'frown'], ['😧', 'anguished'], ['😨', 'fearful scared'],
        ['😰', 'anxious sweat'], ['😥', 'sad relieved'], ['😢', 'cry sad tear'],
        ['😭', 'sob cry bawl'], ['😱', 'scream fear'], ['😖', 'confounded'],
        ['😣', 'persevere'], ['😞', 'disappointed sad'], ['😓', 'downcast sweat'],
        ['😩', 'weary tired'], ['😫', 'tired'], ['🥱', 'yawn bored'],
        ['😤', 'triumph steam'], ['😡', 'angry mad rage'], ['😠', 'angry mad'],
        ['🤬', 'cursing swear'], ['😈', 'devil smile'], ['👿', 'devil angry'],
        ['💀', 'skull dead'], ['💩', 'poop'], ['🤡', 'clown'], ['👻', 'ghost'],
        ['👽', 'alien'], ['🤖', 'robot'], ['🎃', 'pumpkin halloween']
      ]
    },
    {
      id: 'gestures', icon: '👍', name: 'Gestures & Body', list: [
        ['👍', 'thumbs up like yes'], ['👎', 'thumbs down dislike no'],
        ['👌', 'ok perfect'], ['🤌', 'pinch italian'], ['🤏', 'pinch small'],
        ['✌️', 'peace victory'], ['🤞', 'fingers crossed luck'], ['🤟', 'love you'],
        ['🤘', 'rock horns'], ['🤙', 'call me hang loose'], ['👈', 'left point'],
        ['👉', 'right point'], ['👆', 'up point'], ['👇', 'down point'],
        ['☝️', 'index up'], ['✋', 'raised hand stop'], ['🤚', 'back hand'],
        ['🖐️', 'hand fingers'], ['🖖', 'vulcan spock'], ['👋', 'wave hello hi bye'],
        ['🤝', 'handshake deal'], ['👏', 'clap applause'], ['🙌', 'raise hands praise'],
        ['👐', 'open hands'], ['🤲', 'palms together'], ['🙏', 'pray thanks please'],
        ['✍️', 'writing'], ['💅', 'nails'], ['🤳', 'selfie'], ['💪', 'muscle strong'],
        ['👀', 'eyes look'], ['👁️', 'eye'], ['🧠', 'brain'], ['👅', 'tongue'],
        ['👂', 'ear'], ['👃', 'nose'], ['🦶', 'foot'], ['🦵', 'leg'],
        ['❤️‍🔥', 'heart fire passion'], ['🫶', 'heart hands love']
      ]
    },
    {
      id: 'animals', icon: '🐶', name: 'Animals & Nature', list: [
        ['🐶', 'dog puppy'], ['🐱', 'cat kitten'], ['🐭', 'mouse'], ['🐹', 'hamster'],
        ['🐰', 'rabbit bunny'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'],
        ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'],
        ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'],
        ['🐧', 'penguin'], ['🐦', 'bird'], ['🐤', 'chick'], ['🦆', 'duck'],
        ['🦅', 'eagle'], ['🦉', 'owl'], ['🦇', 'bat'], ['🐺', 'wolf'],
        ['🐗', 'boar'], ['🐴', 'horse'], ['🦄', 'unicorn'], ['🐝', 'bee'],
        ['🐛', 'bug caterpillar'], ['🦋', 'butterfly'], ['🐌', 'snail'],
        ['🐞', 'ladybug'], ['🐜', 'ant'], ['🕷️', 'spider'], ['🦂', 'scorpion'],
        ['🐢', 'turtle'], ['🐍', 'snake'], ['🦎', 'lizard'], ['🐙', 'octopus'],
        ['🦑', 'squid'], ['🦐', 'shrimp'], ['🦀', 'crab'], ['🐡', 'fish'],
        ['🐠', 'fish tropical'], ['🐟', 'fish'], ['🐬', 'dolphin'], ['🐳', 'whale'],
        ['🐋', 'whale'], ['🦈', 'shark'], ['🐊', 'crocodile'], ['🐅', 'tiger'],
        ['🐆', 'leopard'], ['🦓', 'zebra'], ['🦍', 'gorilla'], ['🐘', 'elephant'],
        ['🦒', 'giraffe'], ['🐫', 'camel'], ['🐑', 'sheep'], ['🐐', 'goat'],
        ['🌸', 'flower blossom'], ['🌼', 'flower'], ['🌻', 'sunflower'],
        ['🌹', 'rose flower'], ['🌷', 'tulip'], ['🌺', 'hibiscus'], ['🌴', 'palm tree'],
        ['🌵', 'cactus'], ['🌲', 'tree evergreen'], ['🍀', 'clover luck'],
        ['🍁', 'maple leaf'], ['🍃', 'leaves'], ['⭐', 'star'], ['🌟', 'star glow'],
        ['🌙', 'moon'], ['☀️', 'sun'], ['⛅', 'cloud sun'], ['☁️', 'cloud'],
        ['🌈', 'rainbow'], ['🔥', 'fire lit hot'], ['💧', 'drop water'],
        ['🌊', 'wave ocean'], ['❄️', 'snow cold'], ['⚡', 'lightning bolt']
      ]
    },
    {
      id: 'food', icon: '🍔', name: 'Food & Drink', list: [
        ['🍏', 'apple green'], ['🍎', 'apple red'], ['🍐', 'pear'], ['🍊', 'orange'],
        ['🍋', 'lemon'], ['🍌', 'banana'], ['🍉', 'watermelon'], ['🍇', 'grapes'],
        ['🍓', 'strawberry'], ['🫐', 'blueberry'], ['🍒', 'cherry'], ['🍑', 'peach'],
        ['🥭', 'mango'], ['🍍', 'pineapple'], ['🥥', 'coconut'], ['🥝', 'kiwi'],
        ['🍅', 'tomato'], ['🥑', 'avocado'], ['🍆', 'eggplant'], ['🥔', 'potato'],
        ['🥕', 'carrot'], ['🌽', 'corn'], ['🌶️', 'pepper spicy'], ['🥦', 'broccoli'],
        ['🧄', 'garlic'], ['🧅', 'onion'], ['🍄', 'mushroom'], ['🥜', 'peanut'],
        ['🍞', 'bread'], ['🥐', 'croissant'], ['🥖', 'baguette'], ['🥨', 'pretzel'],
        ['🧀', 'cheese'], ['🥚', 'egg'], ['🍳', 'egg fried'], ['🥞', 'pancakes'],
        ['🧇', 'waffle'], ['🥓', 'bacon'], ['🍔', 'burger'], ['🍟', 'fries'],
        ['🍕', 'pizza'], ['🌭', 'hotdog'], ['🥪', 'sandwich'], ['🌮', 'taco'],
        ['🌯', 'burrito'], ['🥗', 'salad'], ['🍝', 'pasta spaghetti'], ['🍜', 'ramen noodles'],
        ['🍲', 'stew'], ['🍣', 'sushi'], ['🍱', 'bento'], ['🍤', 'shrimp tempura'],
        ['🍚', 'rice'], ['🍛', 'curry'], ['🍙', 'rice ball'], ['🍦', 'ice cream'],
        ['🍰', 'cake slice'], ['🎂', 'birthday cake'], ['🧁', 'cupcake'], ['🍪', 'cookie'],
        ['🍩', 'donut'], ['🍫', 'chocolate'], ['🍬', 'candy'], ['🍭', 'lollipop'],
        ['🍯', 'honey'], ['🍿', 'popcorn'], ['☕', 'coffee tea'], ['🍵', 'tea'],
        ['🧃', 'juice'], ['🥤', 'soda drink'], ['🍺', 'beer'], ['🍻', 'cheers beer'],
        ['🥂', 'champagne cheers'], ['🍷', 'wine'], ['🥃', 'whiskey'], ['🍸', 'cocktail'],
        ['🍹', 'tropical drink'], ['🍾', 'champagne bottle']
      ]
    },
    {
      id: 'activity', icon: '⚽', name: 'Activities', list: [
        ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🏈', 'football'],
        ['⚾', 'baseball'], ['🥎', 'softball'], ['🎾', 'tennis'], ['🏐', 'volleyball'],
        ['🏉', 'rugby'], ['🎱', 'pool billiards'], ['🏓', 'ping pong'],
        ['🏸', 'badminton'], ['🥅', 'goal'], ['🏒', 'hockey'], ['🏏', 'cricket'],
        ['⛳', 'golf'], ['🏹', 'bow archery'], ['🎣', 'fishing'], ['🥊', 'boxing'],
        ['🥋', 'martial arts'], ['🎽', 'running'], ['⛸️', 'skating'], ['🥌', 'curling'],
        ['🛹', 'skateboard'], ['🛼', 'roller skate'], ['🎿', 'ski'], ['🏂', 'snowboard'],
        ['🏋️', 'lift gym'], ['🤼', 'wrestle'], ['🤸', 'cartwheel'], ['🤾', 'handball'],
        ['🏌️', 'golf'], ['🏇', 'horse racing'], ['🧘', 'yoga meditate'],
        ['🏄', 'surf'], ['🏊', 'swim'], ['🚴', 'cycle bike'], ['🚵', 'mountain bike'],
        ['🎯', 'dart target'], ['🎮', 'game controller'], ['🎲', 'dice'],
        ['🎰', 'slot machine'], ['🎳', 'bowling'], ['🎭', 'theater drama'],
        ['🎨', 'art paint'], ['🎬', 'movie film'], ['🎤', 'mic sing'],
        ['🎧', 'headphones music'], ['🎼', 'music notes'], ['🎹', 'piano'],
        ['🥁', 'drum'], ['🎷', 'sax'], ['🎺', 'trumpet'], ['🎸', 'guitar'],
        ['🎻', 'violin'], ['🏆', 'trophy win'], ['🥇', 'gold medal first'],
        ['🥈', 'silver medal'], ['🥉', 'bronze medal'], ['🏅', 'medal'],
        ['🎖️', 'medal honor'], ['🎫', 'ticket'], ['🎟️', 'ticket'],
        ['🎉', 'party tada celebrate'], ['🎊', 'confetti'], ['🎈', 'balloon'],
        ['🎁', 'gift present'], ['🎀', 'ribbon bow'], ['🎄', 'christmas tree']
      ]
    },
    {
      id: 'travel', icon: '✈️', name: 'Travel & Places', list: [
        ['🚗', 'car'], ['🚕', 'taxi'], ['🚙', 'suv'], ['🚌', 'bus'], ['🚎', 'trolley'],
        ['🏎️', 'race car'], ['🚓', 'police car'], ['🚑', 'ambulance'], ['🚒', 'fire truck'],
        ['🚐', 'van'], ['🚚', 'truck'], ['🚛', 'truck'], ['🚜', 'tractor'],
        ['🛵', 'scooter'], ['🏍️', 'motorcycle'], ['🚲', 'bike'], ['🛴', 'kick scooter'],
        ['🚨', 'siren alert'], ['🚀', 'rocket launch'], ['✈️', 'plane flight'],
        ['🛫', 'takeoff'], ['🛬', 'landing'], ['🚁', 'helicopter'], ['⛵', 'sailboat'],
        ['🚤', 'speedboat'], ['🛳️', 'ship cruise'], ['⚓', 'anchor'], ['🚂', 'train'],
        ['🚆', 'train'], ['🚇', 'metro subway'], ['🚊', 'tram'], ['🚉', 'station'],
        ['🗺️', 'map'], ['🧭', 'compass'], ['🏔️', 'mountain'], ['⛰️', 'mountain'],
        ['🌋', 'volcano'], ['🏕️', 'camping'], ['🏖️', 'beach'], ['🏝️', 'island'],
        ['🏜️', 'desert'], ['🏞️', 'park nature'], ['🌅', 'sunrise'], ['🌄', 'sunrise mountain'],
        ['🌃', 'night city'], ['🌆', 'sunset city'], ['🌇', 'sunset'], ['🌉', 'bridge night'],
        ['🏙️', 'city skyline'], ['🗽', 'statue liberty'], ['🗼', 'tower tokyo'],
        ['🏰', 'castle'], ['🏯', 'castle japan'], ['🎡', 'ferris wheel'],
        ['🎢', 'roller coaster'], ['🎠', 'carousel'], ['⛲', 'fountain'],
        ['🏠', 'house home'], ['🏡', 'house garden'], ['🏢', 'office building'],
        ['🏥', 'hospital'], ['🏦', 'bank'], ['🏨', 'hotel'], ['🏫', 'school'],
        ['⛪', 'church'], ['🕌', 'mosque'], ['🛕', 'temple'], ['🌍', 'earth globe world'],
        ['🌎', 'earth americas'], ['🌏', 'earth asia']
      ]
    },
    {
      id: 'objects', icon: '💡', name: 'Objects', list: [
        ['⌚', 'watch'], ['📱', 'phone mobile'], ['💻', 'laptop computer'],
        ['⌨️', 'keyboard'], ['🖥️', 'desktop'], ['🖨️', 'printer'], ['🖱️', 'mouse'],
        ['💽', 'disk'], ['💾', 'floppy save'], ['💿', 'cd'], ['📷', 'camera'],
        ['📸', 'camera flash'], ['📹', 'video camera'], ['🎥', 'movie camera'],
        ['📞', 'phone call'], ['☎️', 'telephone'], ['📺', 'tv'], ['📻', 'radio'],
        ['🧭', 'compass'], ['⏰', 'alarm clock'], ['⏱️', 'stopwatch'], ['⌛', 'hourglass'],
        ['🔋', 'battery'], ['🔌', 'plug'], ['💡', 'idea light bulb'], ['🔦', 'flashlight'],
        ['🕯️', 'candle'], ['🧯', 'extinguisher'], ['💸', 'money flying'], ['💵', 'dollar cash'],
        ['💰', 'money bag'], ['💳', 'credit card'], ['💎', 'diamond gem'], ['⚖️', 'scale justice'],
        ['🔧', 'wrench tool'], ['🔨', 'hammer'], ['🛠️', 'tools'], ['⚙️', 'gear settings'],
        ['🔩', 'nut bolt'], ['🧱', 'brick'], ['🔗', 'link chain'], ['📎', 'paperclip'],
        ['✏️', 'pencil'], ['✒️', 'pen'], ['🖊️', 'pen'], ['🖌️', 'paintbrush'],
        ['📝', 'memo note'], ['📒', 'notebook'], ['📚', 'books'], ['📖', 'book open'],
        ['🔖', 'bookmark'], ['📰', 'newspaper'], ['🗞️', 'newspaper'], ['📅', 'calendar'],
        ['📆', 'calendar'], ['📁', 'folder'], ['📂', 'folder open'], ['📌', 'pin'],
        ['📍', 'location pin'], ['🔍', 'search magnify'], ['🔎', 'search'],
        ['🔒', 'lock'], ['🔓', 'unlock'], ['🔑', 'key'], ['🗝️', 'key old'],
        ['🔔', 'bell notification'], ['🔕', 'mute bell'], ['📢', 'megaphone announce'],
        ['📣', 'cheer megaphone'], ['💬', 'speech bubble chat'], ['💭', 'thought bubble'],
        ['🗯️', 'anger bubble'], ['💉', 'syringe'], ['💊', 'pill medicine'],
        ['🩹', 'bandage'], ['🌡️', 'thermometer'], ['🧪', 'test tube'], ['🧬', 'dna'],
        ['🔬', 'microscope'], ['🔭', 'telescope'], ['📡', 'satellite']
      ]
    },
    {
      id: 'symbols', icon: '❤️', name: 'Symbols', list: [
        ['❤️', 'heart love red'], ['🧡', 'orange heart'], ['💛', 'yellow heart'],
        ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
        ['🖤', 'black heart'], ['🤍', 'white heart'], ['🤎', 'brown heart'],
        ['💔', 'broken heart'], ['❣️', 'heart exclamation'], ['💕', 'two hearts love'],
        ['💞', 'revolving hearts'], ['💓', 'beating heart'], ['💗', 'growing heart'],
        ['💖', 'sparkling heart'], ['💘', 'heart arrow cupid'], ['💝', 'heart gift'],
        ['💟', 'heart decoration'], ['💌', 'love letter'], ['💋', 'kiss lips'],
        ['💯', 'hundred perfect'], ['💢', 'anger'], ['💥', 'boom explosion'],
        ['💫', 'dizzy star'], ['💦', 'sweat splash'], ['💨', 'dash wind'],
        ['🕳️', 'hole'], ['💬', 'speech chat'], ['🗨️', 'speech'], ['✅', 'check tick yes done'],
        ['☑️', 'checkbox'], ['✔️', 'check'], ['❌', 'cross no wrong'], ['❎', 'cross mark'],
        ['➕', 'plus add'], ['➖', 'minus'], ['➗', 'divide'], ['✖️', 'multiply'],
        ['❓', 'question'], ['❔', 'question white'], ['❗', 'exclamation'],
        ['❕', 'exclamation white'], ['⚠️', 'warning caution'], ['🚫', 'no forbidden'],
        ['✨', 'sparkles shine'], ['🌟', 'glowing star'], ['⭐', 'star'],
        ['💲', 'dollar'], ['💱', 'currency'], ['♻️', 'recycle'], ['⚜️', 'fleur'],
        ['🔱', 'trident'], ['📛', 'name badge'], ['🔰', 'beginner'], ['⭕', 'circle'],
        ['🆗', 'ok'], ['🆕', 'new'], ['🆒', 'cool'], ['🆓', 'free'], ['🅰️', 'a'],
        ['🔠', 'letters'], ['🔢', 'numbers'], ['🔣', 'symbols'], ['🔤', 'abc'],
        ['🎵', 'music note'], ['🎶', 'music notes'], ['➡️', 'right arrow'],
        ['⬅️', 'left arrow'], ['⬆️', 'up arrow'], ['⬇️', 'down arrow'],
        ['🔝', 'top'], ['🔙', 'back'], ['🔜', 'soon'], ['🔄', 'refresh sync'],
        ['🔃', 'reload'], ['♾️', 'infinity'], ['🕐', 'clock time']
      ]
    }
  ];

  // Flatten once for search.
  const ALL = [];
  for (const c of CATEGORIES) {
    for (const [e, kw] of c.list) ALL.push({ e, kw });
  }

  function getRecent() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [];
    } catch (e) { return []; }
  }
  function pushRecent(emoji) {
    if (!emoji) return;
    let list = getRecent().filter(e => e !== emoji);
    list.unshift(emoji);
    list = list.slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function quickRow() {
    const recent = getRecent();
    const base = recent.length ? recent : DEFAULT_QUICK;
    // Always show 6 in the quick row; pad with defaults if recents are sparse.
    const out = [];
    for (const e of base) { if (!out.includes(e)) out.push(e); if (out.length === 6) break; }
    for (const e of DEFAULT_QUICK) { if (out.length === 6) break; if (!out.includes(e)) out.push(e); }
    return out;
  }

  let pop = null;
  let opts = null;
  let onDocClick = null;
  let onKey = null;
  let onReposition = null;
  let anchorRef = null;

  function close() {
    if (!pop) return;
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onReposition);
    window.removeEventListener('scroll', onReposition, true);
    pop.remove();
    pop = null; opts = null; anchorRef = null;
  }

  function emojiBtn(e) {
    return `<button type="button" class="emoji-cell" data-emoji="${e}" title="${e}">${e}</button>`;
  }

  function buildPanel() {
    const recent = getRecent();
    const sections = [];
    if (recent.length) {
      sections.push(`<div class="emoji-sec" data-cat="recent">
        <div class="emoji-sec-title">Recently used</div>
        <div class="emoji-grid">${recent.map(emojiBtn).join('')}</div></div>`);
    }
    for (const c of CATEGORIES) {
      sections.push(`<div class="emoji-sec" data-cat="${c.id}">
        <div class="emoji-sec-title">${c.name}</div>
        <div class="emoji-grid">${c.list.map(([e]) => emojiBtn(e)).join('')}</div></div>`);
    }
    const tabs = [];
    if (recent.length) tabs.push(`<button type="button" class="emoji-tab" data-go="recent" title="Recently used">🕘</button>`);
    for (const c of CATEGORIES) {
      tabs.push(`<button type="button" class="emoji-tab" data-go="${c.id}" title="${c.name}">${c.icon}</button>`);
    }
    return `
      <div class="emoji-search-wrap">
        <input type="text" class="emoji-search" placeholder="Search emoji" aria-label="Search emoji" />
      </div>
      <div class="emoji-scroll">${sections.join('')}
        <div class="emoji-noresults" hidden>No emoji found</div>
      </div>
      <div class="emoji-tabs">${tabs.join('')}</div>`;
  }

  function position() {
    if (!pop || !anchorRef) return;
    const r = anchorRef.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const margin = 8;
    let left = r.left;
    // Clamp horizontally into the viewport.
    left = Math.min(left, window.innerWidth - pw - margin);
    left = Math.max(margin, left);
    // Prefer above the anchor; fall back to below if there's no room.
    let top = r.top - ph - 6;
    if (top < margin) top = Math.min(r.bottom + 6, window.innerHeight - ph - margin);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(Math.max(margin, top)) + 'px';
  }

  function runSearch(term) {
    if (!pop) return;
    const scroll = pop.querySelector('.emoji-scroll');
    const none = pop.querySelector('.emoji-noresults');
    term = (term || '').trim().toLowerCase();
    if (!term) {
      // Restore the normal sectioned view.
      scroll.querySelectorAll('.emoji-sec').forEach(s => { s.hidden = false; });
      let res = scroll.querySelector('.emoji-search-results');
      if (res) res.remove();
      if (none) none.hidden = true;
      return;
    }
    scroll.querySelectorAll('.emoji-sec').forEach(s => { s.hidden = true; });
    const matches = ALL.filter(o => o.kw.includes(term) || o.e === term);
    let res = scroll.querySelector('.emoji-search-results');
    if (!res) {
      res = document.createElement('div');
      res.className = 'emoji-sec emoji-search-results';
      scroll.insertBefore(res, none);
    }
    res.hidden = false;
    if (!matches.length) {
      res.innerHTML = '';
      if (none) none.hidden = false;
    } else {
      if (none) none.hidden = true;
      res.innerHTML = `<div class="emoji-grid">${matches.map(o => emojiBtn(o.e)).join('')}</div>`;
    }
  }

  function pick(emoji) {
    pushRecent(emoji);
    if (opts && typeof opts.onPick === 'function') opts.onPick(emoji);
    if (!opts || !opts.keepOpenOnPick) close();
  }

  function open(anchorEl, options) {
    close();
    opts = options || {};
    anchorRef = anchorEl;
    pop = document.createElement('div');
    pop.className = 'emoji-pop';
    pop.setAttribute('role', 'dialog');

    const quick = quickRow();
    pop.innerHTML = `
      <div class="emoji-quickbar">
        ${quick.map(e => `<button type="button" class="emoji-quick" data-emoji="${e}" title="${e}">${e}</button>`).join('')}
        <button type="button" class="emoji-more" title="More emojis" aria-label="More emojis">＋</button>
      </div>
      <div class="emoji-panel"${opts.startExpanded ? '' : ' hidden'}>${buildPanel()}</div>`;
    document.body.appendChild(pop);
    position();

    const panel = pop.querySelector('.emoji-panel');
    const moreBtn = pop.querySelector('.emoji-more');
    moreBtn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      position();
      if (!panel.hidden) {
        const s = panel.querySelector('.emoji-search');
        if (s) s.focus();
      }
    });

    pop.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-emoji]');
      if (cell) { e.preventDefault(); pick(cell.dataset.emoji); return; }
      const tab = e.target.closest('.emoji-tab');
      if (tab) {
        const sec = panel.querySelector(`.emoji-sec[data-cat="${tab.dataset.go}"]`);
        if (sec) sec.scrollIntoView({ block: 'start' });
      }
    });

    const search = pop.querySelector('.emoji-search');
    if (search) search.addEventListener('input', () => runSearch(search.value));

    onDocClick = (e) => {
      if (pop && !pop.contains(e.target) && e.target !== anchorEl && !(anchorEl && anchorEl.contains(e.target))) close();
    };
    onKey = (e) => { if (e.key === 'Escape') close(); };
    onReposition = () => position();
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    if (opts.startExpanded) position();
  }

  window.EmojiPicker = { open, close, getRecent, pushRecent, DEFAULT_QUICK };
})();
