import { Application, Asset, AssetListLoader, StandardMaterial, Color, Entity, Vec3, FILLMODE_FILL_WINDOW, RESOLUTION_AUTO } from 'playcanvas';

// Create application
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const app = new Application(canvas, {
    graphicsDeviceOptions: {
        antialias: false
    }
});
app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
app.setCanvasResolution(RESOLUTION_AUTO);
app.start();

window.addEventListener('resize', () => app.resizeCanvas());

// Load assets
const assets = [
    new Asset('camera-controls', 'script', {
        url: 'https://cdn.jsdelivr.net/npm/playcanvas/scripts/esm/camera-controls.mjs'
    }),
    new Asset('campus', 'gsplat', {
        url: 'point_cloud_compressed.sog'
    })
];

const loader = new AssetListLoader(assets, app.assets);
await new Promise(resolve => loader.load(resolve));

// Create camera entity
const camera = new Entity('Camera');
camera.setPosition(0, 0, 2.5);
camera.addComponent('camera');
camera.addComponent('script');
camera.script.create('cameraControls');
app.root.addChild(camera);


// Add Cylinder primitive
const cylinder = new Entity("Cylinder");
cylinder.addComponent("render", {
    type: "cylinder",
    material: new StandardMaterial()
});
cylinder.render.material.diffuse = new Color(0.7, 0.7, 0.7); // gray
cylinder.render.material.update();

cylinder.setLocalScale(30, 30, 30);
cylinder.setPosition(-144.18, -85, 328.35);
app.root.addChild(cylinder);

// Create splat entity
const splat = new Entity('Campus Splat');
splat.setPosition(0, -0.7, 0);
splat.setEulerAngles(0, 0, 180);
splat.addComponent('gsplat', { asset: assets[1] });
app.root.addChild(splat);

const light = new Entity('Directional Light');
light.addComponent('light', {
    type: 'directional',
    intensity: 0.9,
    castShadows: true
});
light.setEulerAngles(45, 210, 0);
app.root.addChild(light);

// Log camera position when it moves
let lastPos = new Vec3();

app.on('update', () => {
    const p = camera.getPosition();

    // Only print when position changes
    if (!p.equals(lastPos)) {
        console.log(`Camera Position → x:${p.x.toFixed(2)} y:${p.y.toFixed(2)} z:${p.z.toFixed(2)}`);
        lastPos.copy(p);
    }
});