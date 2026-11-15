# Model tools

These turn heavy, static AI-generated models (for example from afk.ai) into game-ready animated pets.

```bash
npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp three@0.160.0

# 1. Shrink it: about 10k triangles and 1024px textures
node slim.mjs big-model.glb slim.glb 10000 1024

# 2. Rig it with the Shiba Inu skeleton and its animations
#    (idle, walk, gallop, jump, eat, ...)
node retarget.mjs ../pet-park/models/rig-shiba.glb slim.glb ../pet-park/models/new-pet.glb

# If the animal's tail hangs down (unlike the Shiba's curled tail), keep the tail rigid:
RIGID_TAIL=1 node retarget.mjs ../pet-park/models/rig-shiba.glb slim.glb ../pet-park/models/new-pet.glb
```

`retarget.mjs` does these things:
- It straightens the model so its body points along +Z. AI sculpts are often turned a little, which makes pets walk sideways.
- It fits the skeleton to the new model's proportions, snapping the leg joints onto its legs.
- It transfers skin weights, binding the legs to the nearest leg bones.
- It rescales the animation motion to fit, working from the rig's true bind pose.

It works best on a four-legged animal that is **standing**, faces **+Z**, and is Y-up. Sitting models can't be rigged this way.
