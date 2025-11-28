import * as pc from "playcanvas";
window.pc = pc;

// --- HELPER: URL & PARAMS ---
function getSceneParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        scene: params.get("scene") || "campus",
        // Check if we have incoming camera coordinates (cx, cy, cz)
        hasCamArgs: params.has("cx"),
        camPos: new pc.Vec3(
            parseFloat(params.get("cx") || 0),
            parseFloat(params.get("cy") || 0),
            parseFloat(params.get("cz") || 2.5)
        ),
        // Check if we have incoming look-at coordinates (lx, ly, lz)
        camLookAt: new pc.Vec3(
            parseFloat(params.get("lx") || 0),
            parseFloat(params.get("ly") || 0),
            parseFloat(params.get("lz") || 0)
        ),		
		lod: parseInt(params.get("lod") || 3)
    };
}

const sceneParams = getSceneParams();
sceneParams.lod = (sceneParams.lod > 3) ? 3 : sceneParams.lod ;
sceneParams.lod = (sceneParams.lod < 0) ? 0 : sceneParams.lod ;

// Create application
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

// Create application
const mouse = new pc.Mouse(canvas);
const touch = new pc.TouchDevice(canvas); // Highly recommended for mobile support

const app = new pc.Application(canvas, {
    mouse: mouse, // Pass them here
    touch: touch,
    elementInput: new pc.ElementInput(canvas, { useMouse: true, useTouch: true }),
    graphicsDeviceOptions: {
        antialias: false
    }
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();

window.addEventListener('resize', () => app.resizeCanvas());

// Load obj-model.js manually and wait for it
await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'Assets/Parsers/obj-model.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
});

// Register the parser
const objParser = new ObjModelParser(app.graphicsDevice);
app.loader.getHandler("model").addParser(objParser, function (url) {
    return (pc.path.getExtension(url) === '.obj');
});

// We load the JSON file corresponding to the current scene name
const jsonAsset = new pc.Asset('scene-data', 'json', {
    url: `Assets/${sceneParams.scene}.json`
});

const initialLoader = new pc.AssetListLoader([jsonAsset], app.assets);
await new Promise(resolve => initialLoader.load(resolve));

const sceneData = jsonAsset.resource; // The JSON content

// PREPARE DYNAMIC ASSETS
const assets = {
    camera: new pc.Asset('camera-controls', 'script', {
        url: 'https://cdn.jsdelivr.net/npm/playcanvas/scripts/esm/camera-controls.mjs'
    }),
    // Load the splat defined in JSON
    splatmodel: new pc.Asset('gsplatmodel', 'gsplat', {
        url: sceneData.splatAsset
    }),
	font: new pc.Asset('font', 'font', { url: `Fonts/arial.json` })
};

// Create Assets for every portal image defined in the JSON
// We store them in a map to easily retrieve them by portal index/name later
const portalAssets = [];
if (sceneData.portals) {
	sceneData.portals.forEach((portal, index) => {
		const imgAsset = new pc.Asset(`portal-img-${index}`, 'texture', {
			url: portal.image
		});
		assets[`portal-img-${index}`] = imgAsset;
		portalAssets.push(imgAsset);
	});
}
// Process Viewpoint Icons defined in JSON (if any specific ones are requested)
const viewpointAssets = [];
if (sceneData.viewpoints) {
    sceneData.viewpoints.forEach((vp, index) => {
        if (vp.icon) {
            const imgAsset = new pc.Asset(`vp-img-${index}`, 'texture', { url: vp.icon });
            assets[`vp-img-${index}`] = imgAsset;
            viewpointAssets.push(imgAsset);
        }
    });
}

// Process OBJ Models from JSON
// We store the assets in an array so we can map them back to the config later
const objModelAssets = [];
if (sceneData.models) {
    sceneData.models.forEach((modelDef, index) => {
        const url = modelDef.url;
        const ext = pc.path.getExtension(url).toLowerCase();
        
        // Determine asset type: 'container' for GLB, 'model' (handled by parser) for OBJ
        const type = (ext === '.glb' || ext === '.gltf') ? 'container' : 'model';

        const modelAsset = new pc.Asset(modelDef.name || `model-${index}`, type, {
            url: url
        });

        // Add to the main loader object
        assets[`model-${index}`] = modelAsset; 
        // Keep in our specific list for easy access during creation
        objModelAssets.push(modelAsset);
    });
}

const loader = new pc.AssetListLoader(Object.values(assets), app.assets);
await new Promise(resolve => loader.load(resolve));


createOverlayUI(sceneData);

// --- SCENE CONSTRUCTION ---

// 1. Setup Camera and Script FIRST
const camera = new pc.Entity('Camera');
camera.addComponent('camera');
camera.addComponent('script');

// Create the script instance so we can access it immediately
// We capture the returned instance in a variable
const controls = camera.script.create('cameraControls');

app.root.addChild(camera);

// 2. Apply Position and LookAt
if (sceneParams.hasCamArgs) 
{
    const c_p = sceneParams.camPos;
    const c_la = sceneParams.camLookAt;
    camera.setPosition(c_p); 
    camera.lookAt(c_la);
    const angles = camera.getEulerAngles();    
    if (controls) {
        controls.look(c_la, false);
        controls.yaw = angles.y;
        controls.pitch = angles.x;
        controls.ey = angles.y;
        controls.ex = angles.x;
    }
} else {
    camera.setPosition(0, 0, 2.5); 
}


// Instantiate Models defined in JSON
const modelEntities = [];
if (sceneData.models) {
    sceneData.models.forEach((modelDef, index) => {
        const asset = objModelAssets[index];
        let entity;

        // --- HANDLE GLB (Container) ---
        if (asset.type === 'container') {
            // Instantiate the render entity from the GLB container
            entity = asset.resource.instantiateRenderEntity();
            entity.name = modelDef.name || 'GlbModel';
        } 
        // --- HANDLE OBJ (Model Component) ---
        else {
            entity = new pc.Entity(modelDef.name || 'ObjModel');
            entity.addComponent('model', {
                asset: asset
            });
        }

        // Apply Transforms (Works for both types)
        // Set Position
        const p = modelDef.position || [0, 0, 0];
        entity.setPosition(p[0], p[1], p[2]);

        // Set Rotation
        const r = modelDef.rotation || [0, 0, 0];
        entity.setEulerAngles(r[0], r[1], r[2]);

        // Set Scale
        const s = modelDef.scale || [1, 1, 1];
        entity.setLocalScale(s[0], s[1], s[2]);

        app.root.addChild(entity);
        modelEntities.push(entity);
    });
}

// 3. Splat
const splat = new pc.Entity('Scene Splat');
splat.setPosition(0, -0.7, 0);
const s_o = sceneData.orientation;
splat.setEulerAngles(s_o[0], s_o[1], s_o[2]);
splat.addComponent('gsplat', { asset: assets.splatmodel, unified: true }); // Index 1 is the splat
splat.gsplat.lodDistances = sceneData.lodDistances ? sceneData.lodDistances : [5, 10, 25, 50, 65];
app.root.addChild(splat);

// 4. Light
const light1 = new pc.Entity('Directional Light');
light1.addComponent('light', {
    type: 'directional',
    intensity: 0.9,
    castShadows: false
});
light1.setEulerAngles(45, 210, 0);
app.root.addChild(light1);

const screen = new pc.Entity();
screen.addComponent('screen', {
	referenceResolution: new pc.Vec2(1280, 780),
	scaleBlend: 0.5,
	scaleMode: pc.SCALEMODE_NONE,
	screenSpace: true
});
app.root.addChild(screen);

// 5. Create Portals (Billboards)
const portalEntities = [];
if (sceneData.portals) {
	sceneData.portals.forEach((portalDef, index) => {
		const entity = createPortal2D(portalDef, portalAssets[index]);
		portalEntities.push(entity);
	});
}

const viewpointEntities = [];
if (sceneData.viewpoints) {
	sceneData.viewpoints.forEach((vpDef, index) => {
		const entity = createViewpoint(vpDef, viewpointAssets[index]);
		portalEntities.push(entity);		
	});
}


// --- LOAD LABELS FROM JSON ---
const labels = new Map();
if (sceneData.labels) {
    sceneData.labels.forEach(labelData => {
        const textContent = labelData.text || "Label";
        const pos = labelData.position || [0,0,0];
        const fontSize = labelData.fontSize || 42;
        const name = labelData.name || textContent;

        // Default scaling values if not in JSON
        const minScale = labelData.minScale !== undefined ? labelData.minScale : 0.4;
        const maxScale = labelData.maxScale !== undefined ? labelData.maxScale : 2.0;
		const minSizeDist = labelData.minSizeDistance !== undefined ? labelData.minSizeDistance : 50;
        
		let color = new pc.Color(1, 1, 1);
        if (labelData.color && labelData.color.length === 3) {
            color = new pc.Color(labelData.color[0], labelData.color[1], labelData.color[2]);
        }
        
		// Background Color (Default to semi-transparent black)
        // You can add "bgColor": [0,0,0,0.8] to your JSON to override this
        let bgColor = new pc.Color(0, 0, 0, 0.6); 
        if (labelData.bgColor && labelData.bgColor.length >= 3) {
            const a = labelData.bgColor.length === 4 ? labelData.bgColor[3] : 0.6;
            bgColor = new pc.Color(labelData.bgColor[0], labelData.bgColor[1], labelData.bgColor[2], a);
        }
		
        // Pass the new scale arguments
        const label = createFloatingText(
            textContent, 
            new pc.Vec3(pos[0], pos[1], pos[2]), 
            fontSize, 
            color,
			bgColor,
            minScale,
            maxScale,
			minSizeDist
        );
        labels.set(name, label);
    });
}

// -----------------------------------------------------
// EXPOSE CONTEXT
// -----------------------------------------------------
// We attach a context object to the global app instance.
// Loaded scripts can access this via: pc.Application.getApplication().sceneContext

app.sceneContext = {
    camera: camera,
    labels: labels, // The Map containing your text entities
    portals: portalEntities,
    sceneData: sceneData,
	screen: screen,
    createFloatingText: createFloatingText // Even expose functions!
};

if (sceneData.scripts) {
    const scriptAssets = [];
    sceneData.scripts.forEach((scriptUrl, index) => {
        const scriptAsset = new pc.Asset(`custom-script-${index}`, 'script', {
            url: scriptUrl
        });
        scriptAssets.push(scriptAsset);
    });

    // Create a NEW loader just for the scripts
    const scriptLoader = new pc.AssetListLoader(scriptAssets, app.assets);
    await new Promise(resolve => scriptLoader.load(resolve));
}


window.addEventListener('keydown', (event) => {
    if (event.key === 'p' || event.key === 'P') {
        const p = camera.getPosition();
        const r = camera.getEulerAngles();
        const f = camera.forward;
        
        // Formatted for your JSON file (Position)
        console.log(`"targetCameraPosition": [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]`);
        
        // Formatted for JSON (Rotation/Euler Angles)
        // Useful if you want to set specific rotation
        console.log(`"rotation": [${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)}]`);

        // If you use LookAt logic, you can estimate a look target 
        // by projecting 10 units in front of the camera:
        const lookAtX = p.x + (f.x * 10);
        const lookAtY = p.y + (f.y * 10);
        const lookAtZ = p.z + (f.z * 10);
        console.log(`"targetCameraLookAt": [${lookAtX.toFixed(2)}, ${lookAtY.toFixed(2)}, ${lookAtZ.toFixed(2)}]`);
        
        console.log('-----------------------------------');
    }
});

function createFloatingText(text, fixedWorldPos, fontSize, color, bgColor, minScale = 0.5, maxScale = 1.5, minSizeDistance = 50.0) {
    const paddingH = 20; 
    const paddingV = 10; 
    // Approximation of width per character (0.6 is typical for Arial)
    const charWidthRatio = 0.6; 
    // Line height multiplier (1.0 is standard tight fit, 1.2 is looser)
    const lineHeightMult = 1.0; 

    // 1. Create the Background (Wrapper)
    const wrapper = new pc.Entity();
    wrapper.addComponent('element', {
        type: pc.ELEMENTTYPE_IMAGE,
        anchor: new pc.Vec4(0, 0, 0, 0),
        pivot: new pc.Vec2(0.5, 0.5),
        width: 100, // Will be set by setText below
        height: 100,
        color: bgColor,
        opacity: bgColor.a
    });
    screen.addChild(wrapper);

    // 2. Create the Text (Child of Wrapper)
    const textEntity = new pc.Entity();
    textEntity.addComponent('element', {
        type: pc.ELEMENTTYPE_TEXT,
        pivot: new pc.Vec2(0.5, 0.5),
        anchor: new pc.Vec4(0.5, 0.5, 0.5, 0.5), 
        fontAsset: assets.font.id,
        fontSize: fontSize,
        lineHeight: fontSize * lineHeightMult,
        text: "", // Will be set by setText below
        color: color,
        alignment: new pc.Vec2(0.5, 0.5) // Center align text horizontally and vertically
    });
    wrapper.addChild(textEntity);

    // --- NEW: Handle Multi-line Dimensions ---
    wrapper.setText = function(newString) {
        // A. Update the text content
        textEntity.element.text = newString;

        // B. Analyze lines for box sizing
        const lines = newString.split('\n');
        
        // Find the longest line
        let maxLineLength = 0;
        lines.forEach(line => {
            if (line.length > maxLineLength) maxLineLength = line.length;
        });

        // Calculate Width based on the longest line
        const newWidth = (maxLineLength * fontSize * charWidthRatio) + (paddingH * 2);
        
        // Calculate Height based on number of lines
        const totalTextHeight = lines.length * (fontSize * lineHeightMult);
        const newHeight = totalTextHeight + (paddingV * 2);

        wrapper.element.width = newWidth;
        wrapper.element.height = newHeight;
    };

    // Initialize with the starting text
    wrapper.setText(text);

    // 3. Logic for Position and Scaling
    const screenPos = new pc.Vec3();
    const refDistance = minScale * minSizeDistance;

    const updateLabel = () => {
        const camPos = camera.getPosition();
        const dist = camPos.distance(fixedWorldPos);
        camera.camera.worldToScreen(fixedWorldPos, screenPos);

        if (screenPos.z > 0) {
            const scaleFactor = screen.screen.scale;
            screenPos.x /= scaleFactor;
            screenPos.y /= scaleFactor;
            const refResY = screen.screen.referenceResolution.y;
            screenPos.y = refResY - screenPos.y;
            
            wrapper.setLocalPosition(screenPos);

            let finalScale = refDistance / dist;
            if (finalScale < minScale) finalScale = minScale;
            if (finalScale > maxScale) finalScale = maxScale;

            wrapper.setLocalScale(finalScale, finalScale, finalScale);
            wrapper.enabled = true;
        } else {
            wrapper.enabled = false;
        }
    };

    app.on('prerender', updateLabel);
    wrapper.on('destroy', () => { app.off('prerender', updateLabel); });

    return wrapper;
}

// Helper to handle the "click" navigation logic
function navigateToScene(data) {
    console.log(`Traveling to: ${data.targetScene}`);
    const targetPos = data.targetCameraPosition;
    const targetLook = data.targetCameraLookAt;
    
    const params = new URLSearchParams();
    params.set("scene", data.targetScene);
    params.set("cx", targetPos[0]);
    params.set("cy", targetPos[1]);
    params.set("cz", targetPos[2]);
    params.set("lx", targetLook[0]);
    params.set("ly", targetLook[1]);
    params.set("lz", targetLook[2]);
    params.set("lod", sceneParams.lod);
    window.location.href = `index.html?${params.toString()}`;
}

/**
 * Creates a generic 2D Image Billboard (Element) that can optionally track a 3D position.
 * * @param {string} name - Name of the entity
 * @param {pc.Texture} texture - The texture resource
 * @param {pc.Entity} parent - The parent entity (e.g., screen)
 * @param {function} [onClick] - Optional click callback
 * @param {pc.Vec3} [worldPos] - Optional 3D position to track
 * @param {Object} [scaleConfig] - Optional scaling configuration {minScale, maxScale, minSizeDistance}
 * @returns {pc.Entity} The created entity
 */
function createBillboard(name, texture, parent, onClick, worldPos, scaleConfig) {
    const entity = new pc.Entity(name);

    // 1. Setup Image Element
    entity.addComponent('element', {
        type: pc.ELEMENTTYPE_IMAGE,
        texture: texture,
        pivot: new pc.Vec2(0.5, 0.5),
        anchor: new pc.Vec4(0, 0, 0, 0),
        width: 100,
        height: 100,
        useInput: true
    });

    // 2. Handle Interactions
    if (onClick && typeof onClick === 'function') {
        entity.element.on('mousedown', onClick);
        entity.element.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        entity.element.on('mouseleave', () => { document.body.style.cursor = 'default'; });
    }

    // 3. Attach to hierarchy
    if (parent) {
        parent.addChild(entity);
    }

    // 4. Setup 3D Tracking and Scaling (if worldPos is provided)
    if (worldPos) {
        const screenPos = new pc.Vec3();

        // Config Defaults
        const config = scaleConfig || {};
        const minScale = config.minScale !== undefined ? config.minScale : 0.4;
        const maxScale = config.maxScale !== undefined ? config.maxScale : 2.0;
        const minSizeDist = config.minSizeDistance !== undefined ? config.minSizeDistance : 200;
        const refDistance = minScale * minSizeDist;

        const updateBillboard = () => {
			
            // Assuming 'camera', 'app', and 'screen' are available in scope
            const camPos = camera.getPosition();
            const dist = camPos.distance(worldPos);

            camera.camera.worldToScreen(worldPos, screenPos);
	
            // Check if in front of camera (z > 0)
            if (screenPos.z > 0) {
                // Adjust for screen scaling
                const scaleFactor = screen.screen.scale;
                screenPos.x /= scaleFactor;
                screenPos.y /= scaleFactor;
                
                // Flip Y for 2D screen coordinate system
                const refResY = screen.screen.referenceResolution.y;
                screenPos.y = refResY - screenPos.y;
                
                entity.setLocalPosition(screenPos);

                // Calculate Distance-based Scale
                let finalScale = refDistance / dist;
                if (finalScale < minScale) finalScale = minScale;
                if (finalScale > maxScale) finalScale = maxScale;

                entity.setLocalScale(finalScale, finalScale, finalScale);
                entity.enabled = true;
            } else {
                entity.enabled = false;
            }
        };

        const updateHierarchy = () => {
			camera.syncHierarchy();
		};
		
        app.on('prerender', updateBillboard);
        
        // Clean up listener when entity is destroyed
        entity.on('destroy', () => { 
            app.off('prerender', updateBillboard); 
        });
    }

    return entity;
}

/**
 * Creates a 2D Image Portal that tracks a 3D position
 */
function createPortal2D(portalData, textureAsset) {
    // 1. Prepare Data
    const fixedWorldPos = new pc.Vec3(
        portalData.position[0], 
        portalData.position[1], 
        portalData.position[2]
    );

    const scaleConfig = {
        minScale: portalData.minScale,
        maxScale: portalData.maxScale,
        minSizeDistance: portalData.minSizeDistance
    };

    const onPortalClick = () => {
        navigateToScene(portalData);
    };

    // 2. Delegate creation to createBillboard
    // Note: Assuming 'screen' is a global variable available in this scope
    return createBillboard(
        portalData.name || 'Portal',
        textureAsset.resource,
        screen,
        onPortalClick,
        fixedWorldPos,
        scaleConfig
    );
}



function createViewpoint(viewpointData, textureAsset) 
{
        const fixedWorldPos = new pc.Vec3(viewpointData.position[0], viewpointData.position[1], viewpointData.position[2]);

        // Configuration for the billboard scaling
        const scaleConfig = {
            minScale: viewpointData.minScale || 0.4,
            maxScale: viewpointData.maxScale || 1.5,
            minSizeDistance: viewpointData.minSizeDistance || 50
        };

        const onViewpointClick = () => {
             // Convert arrays to Vec3
            const targetPos = new pc.Vec3(viewpointData.targetPosition[0], viewpointData.targetPosition[1], viewpointData.targetPosition[2]);
            const targetLook = new pc.Vec3(viewpointData.targetLookAt[0], viewpointData.targetLookAt[1], viewpointData.targetLookAt[2]);
            
            // Trigger the smooth move
            smoothCameraMove(targetPos, targetLook);
        };

        // Reuse your existing billboard helper
        const entity = createBillboard(
            viewpointData.name || `Viewpoint-${index}`,
            textureAsset.resource,
            screen,
            onViewpointClick,
            fixedWorldPos,
            scaleConfig
        );
        
        viewpointEntities.push(entity);
}


// Helper: Smoothly move camera and sync controls
let cameraTween = null; // Store active tween to allow cancelling
function smoothCameraMove(targetPos, targetLookAt) {
    // 1. Cancel existing tween
    if (cameraTween) {
        cameraTween.off();
        cameraTween = null;
    }

    // 2. DESTROY THE CONTROLS TEMPORARILY
    // This removes all "ghost" state (old pivot, inertia, distance, etc.)
    // We will recreate them fresh when we arrive.
    if (camera.script && camera.script.has('cameraControls')) {
        camera.script.destroy('cameraControls');
    }

    const startPos = camera.getPosition().clone();
    const startRot = camera.getRotation().clone();

    // Calculate Target Rotation
    const dummy = new pc.Entity();
    dummy.setPosition(targetPos);
    dummy.lookAt(targetLookAt);
    const endRot = dummy.getRotation().clone();
    
    // We also need the final Euler angles for the new script later
    const endAngles = dummy.getEulerAngles().clone();
    dummy.destroy();

    let alpha = 0;
    const duration = 1.5;

    const updateMove = (dt) => {
        alpha += dt / duration;
        
        if (alpha >= 1) {
            // --- FINISHED ---
            // 1. Snap to exact final transform
            camera.setPosition(targetPos);
            camera.setRotation(endRot);
            camera.syncHierarchy(); 

            // 2. CREATE FRESH CONTROLS
            // This initializes the script as if the scene just loaded.
            // It will read the CURRENT camera position and "lock in" correctly.
            const newControls = camera.script.create('cameraControls');

            // 3. APPLY INITIAL STATE (Same as your startup logic)
            // We tell it where to look, and set the angles to match our current rotation.
            if (newControls) {
                // Set the Pivot / Target
                if (newControls.look) {
                    newControls.look(targetLookAt, false); // false = immediate/no-transition
                }

                // Sync the angles so the mouse doesn't jump
                if (newControls.hasOwnProperty('yaw')) newControls.yaw = endAngles.y;
                if (newControls.hasOwnProperty('pitch')) newControls.pitch = endAngles.x;
                
                // Some versions use ex/ey
                if (newControls.hasOwnProperty('ey')) newControls.ey = endAngles.y;
                if (newControls.hasOwnProperty('ex')) newControls.ex = endAngles.x;
                
                // Safety: Ensure it's enabled
                newControls.enabled = true;
            }
            
            app.off('update', updateMove);
            cameraTween = null;
        } else {
            // --- MOVING ---
            // Cubic Ease-In-Out for a premium feel
            const t = alpha < 0.5 ? 4 * alpha * alpha * alpha : 1 - Math.pow(-2 * alpha + 2, 3) / 2;

            const curPos = new pc.Vec3();
            curPos.lerp(startPos, targetPos, t);
            camera.setPosition(curPos);

            const curRot = new pc.Quat();
            curRot.slerp(startRot, endRot, t);
            camera.setRotation(curRot);
        }
    };

    app.on('update', updateMove);
    cameraTween = { off: () => app.off('update', updateMove) };
}

// -----------------------------------------------------
// NEW UI SYSTEM
// -----------------------------------------------------

/**
 * Ensures the UI container and CSS styles exist.
 * @returns {HTMLElement} The UI container div
 */
function ensureUIContainer() {
    const containerId = 'ui-container';
    let container = document.getElementById(containerId);

    if (!container) {
        // 1. Inject CSS Styles dynamically
        const styleId = 'custom-ui-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = `
                #ui-container {
                    position: absolute;
                    top: 20px;
                    left: 20px;
                    z-index: 100;
                    display: flex;
                    flex-direction: column; /* Stack dropdowns vertically */
                    gap: 10px;             /* Space between dropdowns */
                    font-family: Arial, sans-serif;
                    pointer-events: none;  /* Let clicks pass through empty space */
                }

                .styled-select {
                    padding: 10px 15px;
                    font-size: 16px;
                    border-radius: 5px;
                    border: 1px solid #ccc;
                    background-color: rgba(255, 255, 255, 0.9);
                    cursor: pointer;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    outline: none;
                    min-width: 200px;
                    pointer-events: auto; /* Re-enable clicks for the dropdowns */
                }

                .styled-select:hover {
                    background-color: #fff;
                }
            `;
            document.head.appendChild(style);
        }

        // 2. Create the Container
        container = document.createElement('div');
        container.id = containerId;
        document.body.appendChild(container);
    }

    return container;
}

/**
 * Creates a generic Dropdown box and adds it to the UI overlay.
 * * @param {Array<{text: string, value: any}>} options - Array of objects defining the menu
 * @param {Function} onSelectionChange - Callback function (value) => { ... }
 * @param {string} [placeholder="Select option..."] - The default disabled top option
 */
function createDropdown(options, onSelectionChange, placeholder = "Select option...") {
    const container = ensureUIContainer();

    // 1. Create the Select Element
    const select = document.createElement('select');
    select.className = 'styled-select';

    // 2. Add Default Placeholder
    const defaultOption = document.createElement('option');
    defaultOption.text = placeholder;
    defaultOption.value = "__default__";
    defaultOption.selected = true;
    defaultOption.disabled = true; // Make it act like a label
    select.appendChild(defaultOption);

    // 3. Populate Options
    options.forEach((opt) => {
        const optionEl = document.createElement('option');
        optionEl.text = opt.text;
        optionEl.value = opt.value;
        select.appendChild(optionEl);
    });

    // 4. Handle Changes
    select.addEventListener('change', (e) => {
        const val = e.target.value;
        if (onSelectionChange && val !== "__default__") {
            onSelectionChange(val);
            
            // Optional: Blur to return keyboard focus to canvas
            select.blur(); 
        }
    });

    // 5. Prevent bubbling (Stop PlayCanvas camera from moving when clicking menu)
    ['mousedown', 'touchstart', 'mousemove'].forEach(evt => {
        select.addEventListener(evt, (e) => e.stopPropagation());
    });

    container.appendChild(select);
    return select;
}

/**
 * Main function to setup the specific UI for this App
 */
function createOverlayUI(sceneData) {
    
    // 1. Setup Viewpoints Dropdown
    if (sceneData.viewpoints && sceneData.viewpoints.length > 0) {
        
        // Map data to {text, value} format
        const vpOptions = sceneData.viewpoints.map((vp, index) => {
            return {
                text: vp.name || `Viewpoint ${index + 1}`,
                value: index // We pass the index as the value
            };
        });

        // Create the dropdown
        createDropdown(vpOptions, (selectedValue) => {
            const index = parseInt(selectedValue);
            if (sceneData.viewpoints[index]) {
					const viewpointData = sceneData.viewpoints[index];
					// This defines what happens when an option is selected
					const targetPos = new pc.Vec3(viewpointData.targetPosition[0], viewpointData.targetPosition[1], viewpointData.targetPosition[2]);
					const targetLook = new pc.Vec3(viewpointData.targetLookAt[0], viewpointData.targetLookAt[1], viewpointData.targetLookAt[2]);
					
					console.log(`UI triggering move to: ${viewpointData.name}`);
					smoothCameraMove(targetPos, targetLook);
				}
            }
			, "Jump to Location...");
    }

	// LoD dropdown
    const qualityOptions = [
        { text: "Desktop Max (0-5)", value: 0 },
        { text: "Desktop (1-5)", value: 1 },
	    { text: "Mobile Max (2-5)", value: 2 },
        { text: "Mobile (3-5)", value: 3 }
    ];
    
	const lodSelect = createDropdown(qualityOptions, (val) =>  {
		sceneParams.lod = val;
		const gsplatSettings = app.scene.gsplat;
		gsplatSettings.lodRangeMin = val;
		gsplatSettings.lodRangeMax = 5;
	}, "LoD Settings");
	
	lodSelect.value = sceneParams.lod;
	lodSelect.dispatchEvent(new Event('change'))

    const LoDMode = [
        { text: "Render Color", value: 0 },
        { text: "Render LoD", value: 1 }
    ];
    
	createDropdown(LoDMode, (val) =>  {
		const gsplatSettings = app.scene.gsplat;
		gsplatSettings.colorizeLod = (val == 1);
	}, "Render");
}