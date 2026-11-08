Pikachu action animations use the existing uploaded sprite artwork and its original palette.
Running frames add a leaning gait with alternating legs and swinging forepaws. Typing frames
alternate downward forepaw strikes; clicking frames extend one paw toward the mouse.
Idle, thinking, success, and error use short sequences selected from the original frames.

Regenerate with `node frontend/scripts/generate-pikachu-actions.cjs` from the repository root.
The generator preserves the original directional sprites and adds GIF references to `sprites.json`.
Each GIF has a transparent 56 × 64 canvas. Running uses 70 ms frames; paw actions use 90 ms frames.

Movement takes priority over a tool action. Once Pikachu arrives, the queued action remains
visible for one second; long-running input continues animating until the tool finishes.
Paused and reduced-motion modes use a still sprite. The other six Pokémon use their existing animations.
