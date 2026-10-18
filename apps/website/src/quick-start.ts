export const quickStart = `npm exec --yes --package=@scenewirejs/cli@1.3.0 -- scenewire init my-video --yes --skills
cd my-video
npm install --save-exact @scenewirejs/cli@1.3.0
npx --no-install playwright install chromium
npx --no-install scenewire doctor
npx --no-install scenewire render-check project.json
npx --no-install scenewire render project.json --output video.mp4
npx --no-install scenewire final-media-qc video.mp4`;
