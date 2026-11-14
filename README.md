# Quest Games

WebXR games for the Meta Quest 3. They run straight in the Quest Browser, so there's no APK and no sideloading.

## Games

- **[Pet Park](pet-park/)** — a Hello World sandbox with 11 dogs and 11 cats. Pet them, watch the cats have playful scuffles, and throw balls for the dogs to chase. The dogs pile on each other to get the ball, then bring it back to you.

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
| Turn / look | Right stick (snap turn) | Drag the mouse |
| Pet | Grip or trigger with your hand near a pet, or just stroke it | Click a nearby pet |
| Ball | Grip a ball, or point at one and grip to pull it to your hand. Swing and let go to throw | Click a ball to pick it up, click again to throw |

There's a waist-height table of tennis balls next to where you start.

Each game is a single `index.html` that loads three.js from a CDN.
