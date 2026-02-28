

# **Project Chimera: The Design Compendium**

## **Part I: The Vision and the World**

This document serves as the canonical design bible for Project Chimera. It establishes the creative, narrative, and mechanical foundations upon which the game is built. It is the single source of truth for the development team, intended to guide all aspects of production, from art and programming to future design and expansion. The world of Project Chimera is one of fractured realities and desperate pacts, and its design is a reflection of this core concept. Every rule, every card, and every faction is an extension of this central vision.

### **1.1 Core Philosophy: A Symphony of Asymmetry**

The foundational design pillar of Project Chimera is **profound asymmetry**. This principle dictates that each of the twelve factions must offer not just a unique aesthetic or a minor variation in strategy, but a fundamentally different way to perceive and play the game. This is achieved through the deep and deliberate integration of a faction's lore, its unique gameplay mechanics, and its bespoke method for generating the resources needed to fuel its powers. A faction is not merely a collection of cards with a shared icon; it is a holistic and self-reinforcing system of belief, strategy, and action.1  
This asymmetry is built upon an interlocking triad of design elements that defines each faction's identity. First, the **lore** establishes the faction's philosophy, its history, and its goals within the shattered cosmos. This narrative foundation is not merely flavor text; it is the wellspring from which all other design choices flow. Second, the **mechanics** are a direct translation of this lore into tangible gameplay. The unique keywords and abilities a faction possesses are designed to allow players to act out the faction's core beliefs on the battlefield. Third, the **Essence generation** method—the unique condition under which a faction gains its primary resource—is inextricably linked to the successful execution of its lore-driven mechanics. This creates a powerful, thematic feedback loop: by playing the faction as its lore dictates, the player is rewarded with the very power needed to further its goals.  
This design pattern is the consistent architectural principle behind every faction. Consider the **Oni Clans** of Japanese folklore. Their lore establishes them as prideful warriors who value brute force and martial dominance above all else.1 This philosophy translates directly into their signature mechanic,  
$Overwhelm$, which ensures that their superior power in combat is never wasted.1 Their method for generating  
Oni Essence is the perfect culmination of this identity: they gain it whenever one of their units destroys an enemy unit in combat.1 Thus, the player is incentivized to seek out and win battles, perfectly aligning their strategic goals with the faction's core identity. The act of being an Oni—a dominant warrior—is precisely how one gains power as an Oni.  
Conversely, look to the **Chthonic Court** of the Greek underworld. Their philosophy is one of inevitability, memory, and the relentless cycle of death.1 Their power comes not from the living, but from the accumulated weight of the dead. This is reflected in their mechanics, such as  
$Shade$, which makes their units resilient to destruction, and $Katabasis$, which allows them to retrieve cards from their discard pile (the Void).1 Their resource generation method closes the loop: they generate  
Stygian Essence based on the number of cards in their own Void.1 They are literally fueled by the ghosts of the past. This encourages a slow, grinding playstyle of attrition that perfectly matches their lore.  
This deliberate, formulaic integration of lore, mechanics, and resource generation is the engine of profound asymmetry. It ensures that playing the Zodiac Concord feels like orchestrating the heavens, while playing the Mesopotamian Scourge feels like spreading an unstoppable plague. This principle must be the immutable guide for all current balancing and any future faction design, ensuring that the game's core vision remains coherent and compelling.

### **1.2 The Sundered Cosmos: History and Lore**

Before the current nightmare, reality was a singular, coherent tapestry. But this tapestry was torn. The **Great Sundering** was not a single event, but a cataclysmic cascade failure that shattered the barriers between dimensions. The heavens, the hells, the afterlives, and the myriad realms of myth and magic—once separate and stable—were violently slammed together. The result is the Sundered Cosmos, a chaotic reality of bleeding, overlapping planes where the laws of physics and metaphysics are in constant flux. Ancient pantheons now find their domains bordering infernal bureaucracies, and the ghosts of forgotten worlds drift through the ruins of celestial kingdoms.  
The seeds of this cataclysm were sown long before it occurred. The celestial rebellion led by the prideful angels who would become the **Host of the Damned** was a key precursor event. Their war scarred the heavens and introduced a fundamental flaw in the divine order, a crack in the foundational logic of creation that would later spread.1 When the Sundering finally came, it was a cosmic scream of such magnitude that it drew the attention of beings from even higher, more alien dimensions. The  
**Enochian Chorus**, entities of pure mathematics and syntax, descended from their Aethyrs not to conquer, but to "correct" the flawed equation of this new reality, their methods just as destructive as any demonic invasion.1  
Into this chaos step the players, who assume the role of **Pact-Makers**. They are rare and powerful individuals who have survived the initial shock of the Sundering and have learned to navigate the treacherous new landscape. They are not heroes or villains in a traditional sense, but mystics, scholars, survivors, and opportunists who have discovered the ultimate truth of the Sundered Cosmos: everything has a price, and power can be bartered for. By making pacts with the myriad entities that now fester in the ruins—demons, gods, spirits, and angels—they can channel their power for their own ends.  
A Pact-Maker's life force is not measured in blood or stamina, but in **Sanity**. As described in the core rules, each player begins with 30 Sanity.1 This resource represents their tether to a coherent reality, their very will to exist in a cosmos that defies comprehension. Every pact made, every horrifying creature summoned, and every glimpse into the bleeding realms chips away at this tether. The objective of the game—to reduce an opponent's Sanity to 0—is therefore not a simple act of violence, but a psychic and existential assault. Victory is achieved by shattering your rival's mind, overwhelming their will to exist until they are consumed by the madness of the Sundered Cosmos.

## **Part II: The Universal Rules of Engagement**

These are the foundational, non-negotiable rules that govern all play in Project Chimera. They provide the universal structure within which the unique asymmetrical mechanics of the factions operate. This section is the primary technical reference for the development team.

### **2.1 The Objective: Shattering Sanity**

The ultimate goal in Project Chimera is to overwhelm a rival Pact-Maker, shattering their will to exist. This is represented by their Sanity total.

* **Primary Win Condition:** Each player begins the game with 30 Sanity. A player immediately wins the game when their opponent's Sanity is reduced to 0 or less.1  
* **Alternate Win Condition:** A player immediately loses the game if they are required to draw a card from their Deck, but their Deck is empty. This is commonly known as "decking out" or "fatigue".1

### **2.2 The Battlefield: Anatomy of the Conflict Zones**

The play area is divided into several distinct zones, each with a specific purpose. Mastery of these zones is crucial for managing resources and executing strategy.1

* **Deck:** A player's library of 40 to 60 cards. It must be shuffled before the game begins and is kept face-down.  
* **Hand:** The set of cards a player has drawn and can play from. The maximum hand size is seven. At the end of a player's turn, if they have more than seven cards in their hand, they must discard down to seven.  
* **The Asphodel Meadows (Discard Pile):** This is the game's primary discard pile. Destroyed Demons, used Invocations, and discarded cards are placed here face-up. Cards in any player's Asphodel Meadows can be viewed by all players at any time.  
* **The Void (Exile Zone):** Cards sent to the Void are removed from the game entirely. They are placed face-up and, by default, cannot be interacted with further. Certain card effects, such as the Yaoguai Court's $Judgment$ keyword, are the rare exception to this rule.1  
* **The Front Line:** This is the main area of play where Demons are summoned, divided into two distinct rows:  
  * **Front Row:** This is the primary combat zone. Demons in the Front Row can attack and can be targeted by attacks. A player can have a maximum of five Demons in their Front Row.  
  * **Back Row:** This is a support zone. By default, Demons in the Back Row cannot attack or be attacked. This row is used to protect valuable Demons with powerful ongoing abilities. Specific card abilities, such as $Aethereal$ or ranged effects, can override this restriction. A player can have a maximum of three Demons in their Back Row.

### **2.3 The Instruments of Power: Card Types and Anatomy**

A player's deck is composed of four distinct types of cards, each serving a different strategic function.1

* **Demon:** The primary actors in the game. These are the creatures, spirits, and entities summoned to the battlefield. They possess Power (the damage they deal in combat) and Health (the amount of damage they can sustain before being destroyed). All Demons belong to a faction.  
* **Invocation:** These are powerful, one-time-use spells or rituals. When an Invocation is played, its effect resolves, and the card is immediately sent to the Asphodel Meadows. Some Invocations are $Preemptive$, meaning they can be played during an opponent's turn with the same timing as an instant.  
* **Pact:** These are continuous enchantments that remain on the battlefield, providing ongoing benefits. Pacts are a key way to generate a steady flow of Essence, but they always come at a recurring $Price$ that must be paid each turn.  
* **Realm:** A special and powerful type of card that fundamentally alters the rules of the game for both players. A Realm affects the entire battlefield. Only one Realm can be in play at any given time. If a new Realm is played, the previous one is destroyed and sent to its owner's Asphodel Meadows.

All cards share a universal anatomy to ensure clarity and readability. The UI/UX team should adhere to a template that clearly displays the following information in consistent locations: Essence Cost, Card Name, Card Art, Faction Icon, Card Type and Subtype, a Rules Text box for abilities and keywords, and Power/Health stats for Demon cards.

### **2.4 The Ritual of Play: Turn Structure and Phases**

Gameplay proceeds in turns, with each player completing a full cycle of four phases before play passes to their opponent. The active player completes all four phases before the next player's turn begins.1

* **1\. Upkeep Phase:** This is the "start of turn" phase.  
  * Any abilities that trigger "at the start of your turn" resolve.  
  * The active player gains 1 base Essence.  
  * The active player must pay all $Prices$ required by any Pact cards they control.  
* **2\. Draw Phase:**  
  * The active player draws one card from their Deck.  
  * The player who goes first skips the Draw Phase on their very first turn of the game to mitigate first-turn advantage.  
* **3\. Main Phase:** This is the core of a player's turn, where most actions are taken. The active player may perform the following actions in any order, as many times as they are able, provided they can pay the costs:  
  * Play a Demon, Invocation, or Pact card from their hand by paying its Essence cost.  
  * Play one (and only one) Realm card from their hand per turn.  
  * Initiate Combat. A player may only choose to enter the combat phase once per turn.  
* **4\. End Phase:** This is the "end of turn" cleanup phase.  
  * Any abilities that trigger "at the end of your turn" resolve.  
  * All damage marked on surviving Demons is removed.  
  * The player's Essence pool empties. Any unused Essence is lost.  
  * If the player has more than seven cards in their hand, they must discard down to the maximum hand size of seven.

### **2.5 The Soul-Pact System: Resources and Costs**

The game features a dual-resource system that is both universal and asymmetrical, forming the core of the game's economy.  
The universal resource used to pay for all cards and abilities is **Essence**. All card costs are denoted by a single numerical value and are paid from a player's Essence pool.1 While every player gains 1 base Essence during their Upkeep Phase, this is rarely sufficient to deploy their most powerful forces.  
The primary method of accelerating Essence generation is deeply tied to the game's core philosophy of asymmetry. Each of the twelve factions has a unique, lore-driven mechanic for generating Essence. While the thematic names for this process differ (e.g., Tainted Essence for the Host of the Damned, Celestial Essence for the Zodiac Concord), they all contribute to the same universal Essence pool.1 A player does not have separate pools of different Essence types; rather, they have one pool of Essence that is filled by fulfilling their faction's unique, thematic conditions. This design choice is critical: it makes the act of generating resources a strategic expression of the faction's identity, forcing players to engage with their faction's unique playstyle to build power.

### **2.6 The Clash of Wills: Combat Resolution**

Combat is the primary method for dealing damage to an opponent's Sanity and destroying their Demons. It is initiated once per turn during the active player's Main Phase and follows a strict sequence of steps.1

* **1\. Declare Attackers Step:** The active player declares which of their eligible Demons in their Front Row will attack. To be eligible, a Demon must be untapped and must not have "summoning sickness" (i.e., it must have been under the player's control since the beginning of their turn, unless it has the $Haste$ keyword). Each attacking Demon is then tapped.  
* **2\. Declare Blockers Step:** The defending player may choose any of their untapped Demons in their Front Row to block incoming attackers. A single Demon can only block one attacker. Demons in the Back Row cannot block unless a specific ability allows it.  
* **3\. Damage Resolution Step:** Combat damage is resolved in two stages to account for specific keywords.  
  * **Preemptive Damage:** First, any attacking or blocking Demons with the $Preemptive$ or $Double Strike$ keywords deal their combat damage.  
  * **Regular Damage:** Second, all other Demons involved in combat, plus those with $Double Strike$, deal their combat damage simultaneously.  
* **Damage Calculation:**  
  * If an attacker is unblocked, it deals damage equal to its Power to the defending player's Sanity.  
  * If an attacker is blocked, the attacker and the blocker deal damage equal to their Power to each other.  
  * If a Demon accumulates damage in a single turn equal to or greater than its Health, it is destroyed and sent to its owner's Asphodel Meadows.

## **Part III: The Twelve Factions**

This section provides the complete design blueprint for each of the twelve core factions of Project Chimera. Each profile details the faction's narrative and philosophical identity, its strategic archetype, its unique mechanical implementation, and its visual language.

### **3.1 Introduction to the Factions**

The twelve factions represent the diverse and warring powers that vie for control in the Sundered Cosmos. They are drawn from a wide array of human mythology, folklore, and esoteric traditions, each bringing a unique worldview and methodology to the conflict. The following table serves as an executive summary of the game's strategic landscape, providing an at-a-glance reference for the core identity of each faction.

| Faction Name | Core Philosophy | Playstyle Archetype | Key Mechanics | Essence Generation Method |
| :---- | :---- | :---- | :---- | :---- |
| **The Goetia** | Power at a terrible price; ambition and corruption. | Combo / Glass Cannon | $Pact$ | Generated when any unit is destroyed. |
| **Zodiac Concord** | Cosmic determinism, fate, and cyclical power. | Control / Late-Game Combo | $Celestial Cycle$, $Dignity$, $Apotheosis$ | Generated based on Ascendant units. |
| **Red Rose Templars** | Zealous purity, righteous fury, and secret knowledge. | Mid-Range / Control | $Zeal$, $Alchemical Transmutation$, $Crusade$ | Generated when a $Zeal$ ability is activated. |
| **Dreamtime Wanderers** | The world as a living narrative sung into being. | Engine-Building / Combo-Control | $Songline$, $Dreaming$ | Generated based on the length of the $Songline$. |
| **Yaoguai Court** | Deception, transformation, and infernal bureaucracy. | Control / Disruption | $Shapeshift$, $Judgment$ | Generated when an opponent's card enters the Void. |
| **Celestial Host** | Reality as a divine language to be rewritten. | Esoteric Combo-Engine | $Call$, $Aethyr$ | Generated when a card is played via $Call$. |
| **Host of the Damned** | Tragic pride, lost grace, and righteous vengeance. | Mid-Range / Control | $Grace$, $Fallen$, $Martyrdom$ | Generated when a unit becomes $Fallen$. |
| **Oni Clans** | Brute force, martial pride, and explosive violence. | Mid-Range / Combat | $Overwhelm$, $Disguise$ | Generated when an Oni destroys a unit in combat. |
| **Chthonic Court** | Inevitability, memory, and the power of the dead. | Attrition / Graveyard Control | $Shade$, $Katabasis$ | Generated based on the number of cards in your Void. |
| **Melanesian Voyagers** | Adaptation to the rhythms of the natural world. | Adaptive Mid-Range | $Tidal Surge$ | Generated when the Tide is switched. |
| **Mesopotamian Scourge** | Primordial chaos, pestilence, and insatiable hunger. | Aggro / Swarm | $Plague$, $Swarm$ | Generated when a unit with $Plague$ is destroyed. |
| **Coven of the Wheel** | Natural balance, harmony, and cyclical living. | Engine-Building / Adaptive Control | $Wheel of the Year$, $Attunement$ | Generated when the Wheel of the Year is advanced. |

### **3.2 The Goetia: The Infernal Court**

* **Philosophy & Flavor:** The Goetia embody the principle of power acquired at a terrible price. Drawing from the demonic hierarchies of Western esotericism, such as the *Ars Goetia*, this faction is about summoning and binding powerful, treacherous entities. Their lore is steeped in themes of ambition, corruption, and the inherent risks of wielding power one can barely control. Every action is a transaction, every surge of power a step closer to damnation.1  
* **Playstyle Archetype:** A high-risk, high-reward "combo" and "glass cannon" faction. The Goetia excel at creating explosive, game-winning turns by sacrificing their own resources—be it Sanity, cards in hand, or units on the board—to fuel their infernal engines. They are formidable but fragile; a single miscalculation can cause their own dark pacts to consume them.1  
* **Unique Mechanics:** Their core mechanic is $Pact$. Cards with this keyword allow the player to pay an additional, specified cost—always a sacrifice—to unlock a significantly more powerful secondary effect. This forces a constant risk/reward calculation, defining the faction's identity.1  
* **Essence Generation:** The Goetia generate **Infernal Essence** whenever any unit—friendly or enemy—is destroyed. This creates a powerful feedback loop that directly rewards their sacrificial playstyle and turns every battle into a source of power.1  
* **Art & UI Concept:** The visual language is that of a forbidden, leather-bound grimoire. Card frames are ornate, with demonic sigils integrated into the filigree. The color palette is deep crimsons, occult purples, and tarnished gold. The art style is dark classical realism, depicting demons with a terrifying dignity inspired by Renaissance demonology.1

### **3.3 The Zodiac Concord: The Celestial Weavers**

* **Philosophy & Flavor:** The Zodiac Concord operates on principles of cosmic determinism and the manipulation of fate. They view the battlefield as a celestial map unfolding according to immutable laws. Their power is patient and inexorable, drawing from the twelve traditional signs of the Western zodiac. However, their perfect system is haunted by a thirteenth power, Ophiuchus the Serpent Bearer, an ancient truth representing the untamable cycle of healing and poison, and the disruption of fate itself.1  
* **Playstyle Archetype:** A quintessential "Control" and "late-game Combo" faction. Their strategy is slow and methodical, building towards a critical mass where their powers surge. Ophiuchus provides a high-risk, high-reward pivot point, allowing them to abandon the predictable cycle for a single, explosive turn of transformative power.1  
* **Unique Mechanics:** Their gameplay revolves around the $Celestial Cycle$, a token that advances through 13 signs each turn. Cards matching the current sign become $Ascendant$, triggering powerful abilities. $Dignity$ adds another layer, granting bonuses or penalties based on traditional astrological placements. The ultimate mechanic is $Apotheosis$, a game-altering state that occurs when the cycle reaches Ophiuchus, granting its cards immense power for one turn.1  
* **Essence Generation:** The Concord generates **Celestial Essence** at the start of their turn, equal to the number of friendly units whose sign is currently $Ascendant$. During $Apotheosis$, they instead gain a large, flat bonus of Essence.1  
* **Art & UI Concept:** The aesthetic is ethereal and cosmic, resembling a celestial map or astrolabe. The color palette is midnight blues, cosmic purples, and shimmering silver. Ophiuchus cards introduce accents of medicinal green and venomous purple. The art is abstract and symbolic, with constellations forming into mythical figures.1

| Zodiac Sign | Symbol | Element | Modality | Ruling Planet | Domicile (Self) | Exaltation | Detriment | Fall |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| Aries | Ram | Fire | Cardinal | Mars | Aries | Sun | Libra | Saturn |
| Taurus | Bull | Earth | Fixed | Venus | Taurus, Libra | Moon | Scorpio, Aries | Uranus |
| Gemini | Twins | Air | Mutable | Mercury | Gemini, Virgo | N/A | Sagittarius, Pisces | Jupiter |
| Cancer | Crab | Water | Cardinal | Moon | Cancer | Jupiter | Capricorn | Mars |
| Leo | Lion | Fire | Fixed | Sun | Leo | N/A | Aquarius | N/A |
| Virgo | Virgin | Earth | Mutable | Mercury | Virgo, Gemini | Mercury | Pisces, Sagittarius | Venus |
| Libra | Scales | Air | Cardinal | Venus | Libra, Taurus | Saturn | Aries, Scorpio | Sun |
| Scorpio | Scorpion | Water | Fixed | Pluto, Mars | Scorpio | Uranus | Taurus | Moon |
| Ophiuchus | Serpent Bearer ⛎︎ | Aether | Transcendental | Asclepius/Chiron | N/A | N/A | N/A | N/A |
| Sagittarius | Archer | Fire | Mutable | Jupiter | Sagittarius, Pisces | N/A | Gemini, Virgo | Mercury |
| Capricorn | Sea-Goat | Earth | Cardinal | Saturn | Capricorn, Aquarius | Mars | Cancer, Leo | Jupiter |
| Aquarius | Water-Bearer | Air | Fixed | Uranus, Saturn | Aquarius, Capricorn | N/A | Leo | Scorpio |
| Pisces | Fish | Water | Mutable | Neptune, Jupiter | Pisces, Sagittarius | Venus | Virgo, Gemini | Mercury |

### **3.4 The Red Rose Templars of the Cross**

* **Philosophy & Flavor:** A militant order of mystical knights, fusing the martial zeal of the historical Knights Templar with the esoteric secrets of Rosicrucianism. They believe the Sundering was a divine test and that they are the chosen arbiters of a new, purified reality. They walk a razor's edge, wielding both divine light and controlled darkness, convinced that only their secret knowledge can save the world from damnation.1  
* **Playstyle Archetype:** Mid-Range / Control. The Templars focus on building a resilient board of powerful, synergistic knights while controlling the flow of the game with disruptive Invocations. They reward a "pure" deckbuilding strategy, and their late-game threats are formidable.1  
* **Unique Mechanics:** $Zeal$ grants a bonus if only Templar cards have been played this turn. $Alchemical Transmutation (X)$ allows a player to pay Essence to discard a card and draw a new one with a bonus effect. $Crusade$ unlocks powerful secondary effects on cards if three or more Templar units have attacked this turn.1  
* **Essence Generation:** The Templars generate **Hallowed Essence** whenever they activate a $Zeal$ ability, rewarding them for their purity and devotion to their cause.1  
* **Art & UI Concept:** The aesthetic is ornate and gothic, like a cathedral window intertwined with thorny rose vines. The color palette is deep crimson, stark white, burnished steel, and alchemical gold. The art is a clean, detailed style reminiscent of illuminated manuscripts with a grimdark edge.1

### **3.5 The Dreamtime Wanderers: The Songline Shapers**

* **Philosophy & Flavor:** For the Wanderers, the world is a living narrative sung into being. This faction draws from Australian Aboriginal mythology, specifically The Dreaming and the Songlines that map the journeys of Ancestor Spirits. They awaken the land's power by retracing these sacred paths. Their units are spirits and ancestors like the Rainbow Serpent and Wandjina.1  
* **Playstyle Archetype:** A unique "engine-building" and "combo-control" style dependent on board development. They are slow to start, playing a sequence of Location cards to build their power base. Once their $Songline$ is established, they unleash a cascade of powerful, interlocking effects.1  
* **Unique Mechanics:** When a Wanderer Location is played adjacent to another, they form a $Songline$. Units with $Dreaming X$ can "travel" along this Songline instead of attacking, triggering powerful abilities specific to each Location they arrive at.1  
* **Essence Generation:** The Wanderers generate **Dreaming Essence** at the start of their turn, equal to the number of Locations in their longest continuous $Songline$. This incentivizes expanding their board presence horizontally.1  
* **Art & UI Concept:** Card frames have organic textures of rock and bark, infused with patterns from traditional Aboriginal art (dot painting, cross-hatching). The color palette is rich ochres, charcoal blacks, and clay whites. The art style is a modern interpretation of the "x-ray" style, revealing internal spiritual structures.1

### **3.6 The Yaoguai Court: The Bureaucracy of Ruin**

* **Philosophy & Flavor:** The Yaoguai Court embodies deception, unpredictable transformation, and the soul-crushing weight of an infernal bureaucracy. This faction synthesizes the wild, shapeshifting nature of Yaoguai (demons from Chinese folklore) with the systematic judgment of Diyu (the underworld). Their agents are tricksters like fox spirits and grim enforcers like Heibai Wuchang.1  
* **Playstyle Archetype:** A cunning "control" and "disruption" faction. They excel at creating uncertainty through hidden information, punishing the opponent for their actions, and using the opponent's own deck and Void as a weapon against them.1  
* **Unique Mechanics:** $Shapeshift$ allows units to be played face-down as a generic 2/2 "Lesser Spirit" and flipped face-up later for a powerful "Reveal" effect. $Judgment$ allows powerful Invocations to be cast from the player's Void, but only if the opponent committed a specific "transgression" on their previous turn.1  
* **Essence Generation:** The Yaoguai Court generates **Soul Essence** whenever an opponent's card is sent to the Void from any zone (play, hand, or library). This rewards discard, milling, and unit destruction, directly fueling their $Judgment$ abilities.1  
* **Art & UI Concept:** Frames resemble ancient Chinese scrolls with dark wood or cracked jade end-caps. The text box appears as calligraphy on aged rice paper. The color palette is stark blacks, ghostly whites, imperial reds, and sickly jade greens. The art is a dark interpretation of traditional ink wash painting.1

### **3.7 The Celestial Host: The Enochian Architects**

* **Philosophy & Flavor:** The Celestial Host perceives reality as a divine language that can be understood and manipulated. Rooted in the arcane system of Enochian magic, they are architects of reality, using angelic "Keys" or "Calls" to invoke geometric angels and reshape the battlefield according to a divine blueprint.1  
* **Playstyle Archetype:** The game's most demanding "combo-engine" faction. Their gameplay is a complex puzzle of hand management, board setup, and sequencing to assemble the components of their powerful "Calls." They are difficult to pilot but capable of producing game-winning effects that defy normal play.1  
* **Unique Mechanics:** Their most powerful cards have a $Call$ cost instead of an Essence cost. To play them, the player must control a specific sequence of "Glyph" units on the field. They are supported by $Aethyr$ cards, unique Locations that provide powerful passive benefits to aid in their complex incantations.1  
* **Essence Generation:** The Host generates **Luminous Essence** whenever they successfully play a card using its $Call$ cost. The amount generated is proportional to the number of Glyphs required, creating a feedback loop where successful incantations fuel even greater ones.1  
* **Art & UI Concept:** The design is clean, precise, and geometric, inspired by the elemental tablets of the Enochian system. Frames are crystalline and translucent. The color palette is luminous whites, electric blues, and brilliant golds. "Angels" are depicted as complex, shifting patterns of light and fractals.1

### **3.8 The Host of the Damned: The Exiled Pride**

* **Philosophy & Flavor:** The Host of the Damned are the survivors of a celestial rebellion, angels cast out of heaven for their pride. They are exiles defined by loss, their divine power now a twisted, sorrowful echo. They fight not for simple conquest, but to reclaim a lost paradise, to burn it in vengeance, or to carve out a kingdom in a universe that has rejected them.1  
* **Playstyle Archetype:** A tragic "mid-range" and "control" faction built on fielding powerful, elite, and resilient individual units. Each of their demons is a fallen champion. Their strategy revolves around establishing board control through individually powerful threats that are difficult to remove.1  
* **Unique Mechanics:** Their units enter with $Grace$ counters, a finite resource spent to activate potent, often defensive, abilities. When a unit has no $Grace$ counters remaining, it becomes $Fallen$, losing its protective abilities but gaining new, more aggressive ones. Many also have $Martyrdom$, a triggered ability that occurs when the unit is destroyed.1  
* **Essence Generation:** The Host generates **Tainted Essence** whenever one of their units becomes $Fallen$. This rewards them for burning through their divine power, turning their descent into a source of strength.1  
* **Art & UI Concept:** Frames are made of cracked and broken marble or obsidian, with shattered stained-glass motifs. The palette is muted grays, sorrowful blues, and blood reds, contrasted with flashes of fading gold. The art is baroque and dramatic, depicting angels with broken wings and expressions of prideful sorrow.1

### **3.9 The Oni Clans: The Iron Fist**

* **Philosophy & Flavor:** The Oni Clans value brute force, martial pride, and sudden, explosive violence. Inspired by the fearsome demons of Japanese folklore, they are peerless warriors who seek to dominate the battlefield through superior combat statistics and direct, powerful abilities, wielding their signature iron clubs, or *kanabō*.1  
* **Playstyle Archetype:** A classic "mid-range," board-centric strategy. Their game plan is to play individually powerful and cost-efficient demons turn after turn, using combat-focused abilities to win engagements and establish dominance. They build an incremental advantage that snowballs into an unstoppable assault.1  
* **Unique Mechanics:** Their primary combat keyword is $Overwhelm$, which allows excess damage dealt to a blocker to be dealt to the opponent's Sanity. Their other key mechanic is $Disguise$, allowing them to play a unit face-down as a generic "Wandering Spirit," which can be turned face-up at any time by paying its Disguise cost, triggering a surprise effect.1  
* **Essence Generation:** The Oni Clans generate **Oni Essence** whenever one of their units destroys an enemy unit in combat. This directly rewards their board-centric, aggressive playstyle and their focus on winning battles.1  
* **Art & UI Concept:** Frames are heavy, dark wood with iron fittings and tiger-pelt patterns. The design feels solid and intimidating. The palette is bold reds, blues, and blacks, with accents of bronze. The art style is a powerful, dynamic take on Ukiyo-e woodblock prints with a modern, gritty edge.1

### **3.10 The Chthonic Court: The Inevitable Tide**

* **Philosophy & Flavor:** The Chthonic Court embodies inevitability, fate, and the relentless cycle of death and memory. Drawn from the Greek underworld, its geography, and its inhabitants, their power comes from the discard pile—the Void—which they treat not as a graveyard, but as a second hand and resource pool. Figures like Hades, Persephone, and Charon dictate the flow of souls.1  
* **Playstyle Archetype:** A slow, "attrition"-based control strategy. They aim to outlast opponents, filling both Voids and using the accumulated dead as fuel for their powerful abilities. They are masters of the long game, winning when all other resources have been exhausted.1  
* **Unique Mechanics:** $Shade$ allows their units to return to the battlefield with 1 Health the first time they are destroyed, making their board incredibly resilient. $Katabasis X$ is an ability on their Invocations that allows them to return a card with a cost of X or less from their Void to their hand, recycling their most valuable assets.1  
* **Essence Generation:** The Chthonic Court generates **Stygian Essence** at the start of their turn, equal to the number of cards in their Void. This creates a direct link between their "fuel" (the dead) and their power, encouraging self-milling and strategic trades.1  
* **Art & UI Concept:** Frames are made of cold, dark stone like marble or granite, with motifs of Greek funerary art (styluses, obols, asphodel flowers). The palette is somber shades of grey, black, and deep purple. The art is inspired by Greek black-figure and white-ground pottery, with stark, elegant figures.1

### **3.11 The Melanesian Voyagers: The Tidal Spirits**

* **Philosophy & Flavor:** The Melanesian Voyagers are masters of the ocean's rhythms and keepers of its ancient secrets. Drawing from the rich folklore of Polynesia and Melanesia, this faction is comprised of powerful sea spirits, divine navigators, and cunning tricksters. Figures like the demigod Māui define their identity. They are one with the ebb and flow of the ocean, their power waxing and waning with the tides.1  
* **Playstyle Archetype:** A flexible and adaptive "mid-range" faction that shifts its strategy based on the state of the game. They can switch between aggressive and defensive postures, keeping their opponent off-balance with their unpredictable, rhythmic power shifts.1  
* **Unique Mechanics:** Their core mechanic is $Tidal Surge$. At the start of their turn, the player chooses one of two states: High Tide (offensive) or Low Tide (defensive/utility). This choice persists for the turn and triggers different, often complementary, abilities on their cards.1  
* **Essence Generation:** The Voyagers generate **Tidal Essence** whenever they switch the Tide (i.e., choosing High Tide after a turn of Low Tide, or vice-versa). This rewards them for maintaining the rhythm of the ocean and actively adapting their strategy turn by turn.1  
* **Art & UI Concept:** Frames are carved from driftwood and inlaid with mother-of-pearl and abalone shell. Motifs of waves and canoe lashings are prominent. The color palette is oceanic blues and greens, coral pinks, and the white of seafoam. The art is inspired by the dynamic lines and patterns of Polynesian and Melanesian art.1

### **3.12 The Mesopotamian Scourge: The Unrelenting Plague**

* **Philosophy & Flavor:** The Scourge represents primordial chaos, pestilence, and the insatiable hunger of the abyss. Drawing from the ancient and terrifying demons of Mesopotamian mythology, they are not an army but a force of nature—a plague that spreads across the land, devouring everything in its path.1  
* **Playstyle Archetype:** A relentless "aggro" and "swarm" faction. Their strategy revolves around flooding the board with numerous cheap, disposable demons and then leveraging that numerical superiority to fuel powerful effects. They excel at applying constant pressure and wearing down even the mightiest foes through a slow, inevitable sickness.1  
* **Unique Mechanics:** $Plague X$ places X Plague counters on an enemy unit, which deals 1 damage per counter to that unit at the start of its controller's turn. Many of their cards also have the $Swarm$ ability, creating multiple 1/1 demon tokens to flood the board.1  
* **Essence Generation:** The Scourge generates **Plague Essence** whenever a unit with one or more $Plague$ counters on it is destroyed. This directly rewards their core mechanic, turning the spread of disease and the death of the infected into a source of power.1  
* **Art & UI Concept:** Frames are designed to look like cracked clay tablets, with borders etched in cuneiform script. The palette is desaturated desert sands, dried blood, and sickly greens. The art is inspired by Mesopotamian reliefs, depicting demons as monstrous hybrids of human and animal parts.1

### **3.13 The Coven of the Wheel: The Keepers of Balance**

* **Philosophy & Flavor:** The Coven of the Wheel embodies the principles of natural balance, the cycles of life and death, and the sanctity of the earth. Drawing from the core tenets of modern Wicca, this faction reveres a dualistic divinity: the Triple Goddess and the Horned God. Their magic is a tool for healing and protection, governed by the ethical principle to "harm none".1  
* **Playstyle Archetype:** A strategic and adaptive "engine-building" control faction. They do not seek to overwhelm with brute force, but to align their actions with the ever-changing cycles of the year. Their gameplay involves manipulating the state of the board to match the current season, unlocking powerful synergistic effects.1  
* **Unique Mechanics:** The player has an eight-segment $Wheel of the Year$ token that can be advanced each turn by paying Essence. Each of the eight Sabbats on the wheel provides a different passive effect for the turn. Coven units have $Attunement (Sabbat)$ abilities that are only active while the Wheel is on a specific Sabbat.1  
* **Essence Generation:** The Coven generates **Natural Essence** whenever they choose to advance the $Wheel of the Year$. This directly rewards them for engaging with their core cyclical mechanic, representing the drawing of power from the changing seasons.1  
* **Art & UI Concept:** Frames are organic and naturalistic, carved from living wood or woven from branches, decorated with symbols like the pentacle and triskele. The palette is earthy greens, rich browns, and sky blues. The art style is a blend of romanticism and naturalism.1

## **Part IV: Appendices**

This section contains essential reference material for the development team. It codifies the game's terminology and data structures to ensure consistency across all departments.

### **Appendix A: Master Keyword Glossary**

This is the definitive, alphabetized list of all keyword abilities in Project Chimera. The rules text provided here is canonical and supersedes any previous descriptions.

* **Aethereal:** This Demon can only be blocked by other Demons with Aethereal. It can attack Demons in the opponent's Back Row.1  
* **Alchemical Transmutation (X):** As an action from your hand, you may pay X Essence and discard this card to draw a card. The drawn card gains a temporary bonus effect for the turn.1  
* **Ambush:** You may play this card any time you could play a Preemptive Invocation.1  
* **Apotheosis:** A game state that occurs for one turn when the Celestial Cycle reaches Ophiuchus. During this turn, only Ophiuchus cards are considered Ascendant, and they gain powerful, unique abilities.1  
* **Arrival:** This ability triggers when the Demon enters the battlefield.1  
* **Ascendant:** A Zodiac card is Ascendant if its sign matches the current sign of the Celestial Cycle, triggering special abilities.1  
* **Attunement (Sabbat):** An ability on a Coven card that is only active while the Wheel of the Year is on the specified Sabbat.1  
* **Call:** A method of playing a card by controlling a specific sequence of "Glyph" units on the field, rather than paying an Essence cost.1  
* **Celestial Cycle:** A 13-segment marker that advances one sign at the start of the Zodiac player's turn, determining which signs are Ascendant.1  
* **Crusade:** An ability that grants a powerful secondary effect if you have attacked with three or more Templar units this turn.1  
* **Departure:** This ability triggers when the Demon is sent to the Asphodel Meadows from the battlefield.1  
* **Dignity:** A system of bonuses (Domicile, Exaltation) and penalties (Detriment, Fall) applied to the 12 traditional Zodiac signs based on their position in the Celestial Cycle.1  
* **Disguise:** You may play this card face-down as a 2/2 "Wandering Spirit" for 3 Essence. You may turn it face-up at any time by paying its Disguise cost, which often triggers an ability.1  
* **Double Strike:** This Demon deals combat damage twice: once in the Preemptive damage step and again in the regular damage step.1  
* **Dreaming X:** Allows a unit to travel X positions along a connected Songline instead of attacking, triggering abilities at each Location it arrives at.1  
* **Fallen:** A state a Host of the Damned unit enters when it has no Grace counters remaining. It loses its Grace-fueled abilities and gains new, aggressive ones.1  
* **Grace:** A type of counter that Host of the Damned units enter the battlefield with. These counters can be removed to activate powerful, often defensive, abilities.1  
* **Haste:** This Demon can attack on the turn it enters the battlefield.1  
* **Hierarchy:** An ability on Goetia Demons that grants bonuses if other specific Goetia ranks (e.g., King, Duke) are on the battlefield.1  
* **Indestructible:** This Demon cannot be destroyed by damage or "destroy" effects. It is still sent to the Asphodel Meadows if its Health is reduced to 0 or less, or if it is Sacrificed.1  
* **Judgment:** An ability that allows an Invocation to be cast from your Void by paying its Essence cost, but only if your opponent committed a specific transgression on their previous turn.1  
* **Katabasis X:** An ability on an Invocation. Return a card with an Essence cost of X or less from your Asphodel Meadows to your hand.1  
* **Martyrdom:** An ability that triggers when this Demon is destroyed.1  
* **Nomad:** This unit can move to an adjacent friendly zone once per turn as a free action during your Main Phase.1  
* **Overwhelm:** If this Demon deals more combat damage to a blocking Demon than its Health, the excess damage is dealt to the opponent's Sanity.1  
* **Pact:** A keyword on a card that allows the player to pay an additional, specified cost (such as sacrificing a unit or paying Sanity) to unlock a more powerful secondary effect.1  
* **Plague X:** Place X Plague counters on a Demon. At the start of its controller's turn, it takes 1 damage for each Plague counter on it.1  
* **Preemptive:** (Demon) This Demon deals its combat damage before Demons without Preemptive. (Invocation) This Invocation can be played during any player's turn.1  
* **Price:** A recurring negative effect on a Pact card that its controller must resolve during their Upkeep Phase.1  
* **Raid X:** This unit gains \+X Power during any turn in which it has used its Nomad ability.1  
* **Resonance (Aethyr):** An ability on a Call that allows it to be attached to a Demon of a specific Aethyr, granting it a new ability.1  
* **Retrograde:** An ability on an Invocation that allows the Zodiac player to manipulate the Celestial Cycle, moving it forward or backward.1  
* **Sacrifice:** As a cost, choose a permanent you control and put it into its owner's Asphodel Meadows.1  
* **Shade:** When this Demon is destroyed, return it to the battlefield tapped at the end of the turn with 1 Health. Exile it when it is destroyed again.1  
* **Shapeshift:** An ability that allows a Yaoguai unit to be played face-down as a 2/2 "Lesser Spirit." It can be turned face-up at any time by paying a cost, triggering a "Reveal" ability.1  
* **Songline:** A continuous chain of adjacent friendly Location cards.1  
* **Soul-Reap:** Any amount of damage from this source is enough to destroy a Demon.1  
* **Swarm:** An ability that creates multiple 1/1 Demon tokens.1  
* **Tidal Surge:** The core mechanic of the Melanesian Voyagers. At the start of their turn, the player chooses High Tide or Low Tide, which enables different abilities on their cards for that turn.1  
* **Tormentor:** Enemy Demons must attack this Demon if able.1  
* **Wheel of the Year:** A Coven-specific eight-segment marker that can be advanced each turn to change the active Sabbat, providing different global effects.1  
* **Zeal:** An ability that grants a bonus if you have not played any non-Templar cards this turn.1

### **Appendix B: Core Set Card Manifest**

This appendix defines the data structure for all cards in Project Chimera. All card data will be stored in a master cards.json file, which will be parsed by the game engine at runtime. This data-driven approach is essential for efficient development, balancing, and future expansion. Each card in the JSON file will be an object following the template below.  
**JSON Object Template:**

JSON

{  
  "id": "FACTION\_ID\_NUM",  
  "name": "Card Name",  
  "type": "Demon / Invocation / Pact / Realm",  
  "subtype": "Knight / Spell / Ritual / etc.",  
  "faction": "Faction Name / Neutral",  
  "rarity": "Common / Uncommon / Rare / Mythic",  
  "cost": 0,  
  "power": 0,  
  "health": 0,  
  "keywords": \["Keyword1", "Keyword2"\],  
  "effects":,  
  "flavor\_text": "Italicized flavor text.",  
  "art\_path": "res://assets/art/faction\_id\_num.png"  
}

**Sample Card Objects:**

* **The Goetia (Demon):**  
  JSON  
  {  
    "id": "GOETIA\_005",  
    "name": "Amdusias, the Cacophonous Duke",  
    "type": "Demon",  
    "subtype": "Duke",  
    "faction": "The Goetia",  
    "rarity": "Rare",  
    "cost": 4,  
    "power": 2,  
    "health": 5,  
    "keywords": \["Hierarchy", "Pact"\],  
    "effects": \[  
      {  
        "trigger": "Upkeep",  
        "condition": "self",  
        "action": "add\_stats\_to\_target",  
        "target": "random\_enemy\_demon",  
        "value": {"power": \-1, "health": \-1}  
      },  
      {  
        "trigger": "Pact",  
        "condition": "sacrifice\_friendly\_demon",  
        "action": "add\_stats\_to\_all",  
        "target": "all\_enemy\_demons",  
        "value": {"power": \-2, "health": \-2}  
      }  
    \],  
    "flavor\_text": "His music is the sound of reality tearing itself apart.",  
    "art\_path": "res://assets/art/goetia\_005.png"  
  }

* **Neutral (Invocation):**  
  JSON  
  {  
    "id": "NEUTRAL\_012",  
    "name": "Sever the Bond",  
    "type": "Invocation",  
    "subtype": "Spell",  
    "faction": "Neutral",  
    "rarity": "Uncommon",  
    "cost": 3,  
    "power": 0,  
    "health": 0,  
    "keywords": \["Preemptive"\],  
    "effects": \[  
      {  
        "trigger": "OnPlay",  
        "condition": "self",  
        "action": "destroy\_target",  
        "target": "target\_pact\_or\_realm",  
        "value": ""  
      }  
    \],  
    "flavor\_text": "Every pact can be broken. It just requires finding the right leverage.",  
    "art\_path": "res://assets/art/neutral\_012.png"  
  }

#### **Works cited**

1. gemchat.txt
