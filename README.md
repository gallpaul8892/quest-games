# Quest Games

WebXR games for the Meta Quest 3. They run straight in the Quest Browser, so there's no APK and no sideloading.

## Games

- **[Pet Park](pet-park/)** — a pet sandbox: choose up to 20 dogs and 20 cats on the start menu. Pet them, watch the cats have playful scuffles, and throw balls for the dogs to chase. The dogs pile on each other to get the ball, then bring it back to you. Pets get hungry over time: they whine and meow more, squabble more and ignore the ball until you feed them from the automatic feeder. Pets wear collars, nap about 30% of the time (cats in groups or up on the climbing frames), cats need clean litter trays or they get rowdy, and balls of yarn unravel as the cats bat them about. Garden birds (robins, blue tits, blackbirds and sparrows) circle overhead and land to peck at the grass; cats creep up, wiggle and pounce, but the birds always get away. Sleepy pets turn round on the spot, fold their legs and lie down (head on paws, or curled up), breathe slowly while they doze, then get up and have a big stretch. Butterflies flutter about and land on the grass; cats chase and leap at them but never catch one. Now and then a dog chases a cat round the park and gives up when the cat gets away.

## Playing on the Quest

WebXR needs HTTPS, so host the repo with GitHub Pages:

1. Open the repo **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, then pick `main` and `/ (root)`.
3. After a minute or so the site is live at `https://gallpaul8892.github.io/quest-games/`.
4. On the Quest, open **Browser**, go to that address, pick a game and tap **Enter VR**.

### Pet Park controls

| | Quest 3 | Desktop |
|---|---|---|
| Move | Left stick | WASD |
| Exit VR | B button | — |
| Turn / look | Right stick (snap turn) | Drag the mouse |
| Pet | Grip or trigger with your hand near a pet, or just stroke it | Click a nearby pet |
| Ball | Grip a ball, or point at one and grip to pull it to your hand. Swing and let go to throw | Click a ball to pick it up, click again to throw |
| Fake throw | Swing like you're throwing but keep hold of the ball | Hold a ball and press F |
| Feed the pets | Press the big red FEED button (poke it with a finger or controller) | Press E, or click the button |
| Pick up a pet | Grab it with both hands (grip or pinch); let go to put it down | — |
| Clean a litter tray | Reach into the sand, or point at the tray and pinch/trigger | C, or click the tray |
| Ask a cat to jump up | Point at a raised surface (table, cat tree, bench, rock) and quickly tap the trigger or pinch, or tap the surface with a fingertip | Click the surface |
| Teleport | Hold trigger pointing at the ground, release to jump there | — |

**Hand tracking (no controllers):** put the controllers down and the Quest switches to your hands.
- Stroke or pat a pet with your palm.
- Pinch a ball to grab it, then swing and open your fingers to throw.
- Point at a far-away ball and pinch to pull it to your hand.
- Point at the ground, pinch and release to teleport.

There's a waist-height table of tennis balls next to where you start.

Games load three.js from a CDN. Pet Park's animal models are in `pet-park/models/` (CC0, see CREDITS.md).
