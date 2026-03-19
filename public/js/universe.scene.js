import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sparkles, Html } from "@react-three/drei";
import * as THREE from "three";

const e = React.createElement;
let planets = [];
let selectedPlanetId = null;
let autoRotateEnabled = true;
let onPlanetClick = null;

let cameraTarget = null;
let cameraAnimating = false;

const PLANET_LAYOUT = [
    [-50, 0, -10],
    [-35, 0, 35],
    [0, 0, 50],
    [35, 0, 35],
    [50, 0, -10],
    [35, 0, -55],
    [0, 0, -70],
    [-35, 0, -55]
];

const PLANET_SIZES = [3.2, 2.8, 3.5, 2.9, 3.3, 2.7, 3.6, 3.0];
const UNIVERSE_CENTER = new THREE.Vector3(0, 0, -8);
const CAMERA_DIRECTION = new THREE.Vector3(0, 0.55, 0.82).normalize();
const PLANET_FOCUS_DISTANCE = 34;
const PLANET_MOTION = PLANET_LAYOUT.map((position, index) => {
    const base = new THREE.Vector3(...position);
    const radial = base.clone().sub(UNIVERSE_CENTER);
    const radialDirection = radial.clone().normalize();
    const tangentDirection = new THREE.Vector3(-radialDirection.z, 0, radialDirection.x).normalize();

    return {
        base,
        radialDirection,
        tangentDirection,
        orbitRadius: 4.5 + (index % 3) * 1.1,
        orbitSpeed: 0.11 + index * 0.012,
        orbitPhase: index * 0.95,
        bobAmplitude: 0.6 + (index % 2) * 0.25,
        bobSpeed: 0.55 + index * 0.05,
        bobPhase: index * 1.37
    };
});

function getPlanetIndex(roomId) {
    return planets.slice(0, 8).findIndex((planet) => planet.roomId === roomId);
}

function getPlanetWorldPositionByIndex(index, time = 0) {
    const motion = PLANET_MOTION[index];
    if (!motion) return null;

    const orbitAngle = time * motion.orbitSpeed + motion.orbitPhase;
    const tangentOffset = motion.tangentDirection.clone().multiplyScalar(Math.sin(orbitAngle) * motion.orbitRadius);
    const radialOffset = motion.radialDirection.clone().multiplyScalar(Math.cos(orbitAngle) * motion.orbitRadius * 0.38);
    const yOffset = Math.sin(time * motion.bobSpeed + motion.bobPhase) * motion.bobAmplitude;

    return motion.base.clone().add(tangentOffset).add(radialOffset).add(new THREE.Vector3(0, yOffset, 0));
}

function getPlanetWorldPosition(roomId, time = 0) {
    const planetIndex = getPlanetIndex(roomId);
    return planetIndex === -1 ? null : getPlanetWorldPositionByIndex(planetIndex, time);
}

function getOverviewCameraState(camera) {
    const bounds = new THREE.Box3();

    PLANET_MOTION.forEach((motion, index) => {
        const radius = PLANET_SIZES[index] + motion.orbitRadius + motion.bobAmplitude + 3;
        bounds.expandByPoint(motion.base.clone().add(new THREE.Vector3(-radius, -radius, -radius)));
        bounds.expandByPoint(motion.base.clone().add(new THREE.Vector3(radius, radius, radius)));
    });

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = size.length() * 0.5;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = (radius / Math.sin(limitingFov / 2)) * 1.05;

    return {
        target: center,
        position: center.clone().addScaledVector(CAMERA_DIRECTION, distance),
        maxDistance: distance * 1.8
    };
}

export function setScenePlanets(nextPlanets) {
    planets = Array.isArray(nextPlanets) ? nextPlanets : [];
}

export function setSceneSelectedPlanetId(roomId) {
    selectedPlanetId = roomId || null;
}

export function setSceneAutoRotate(enabled) {
    autoRotateEnabled = !!enabled;
}

export function focusPlanet(roomId, distance = PLANET_FOCUS_DISTANCE) {
    const position = getPlanetWorldPosition(roomId);
    if (!position) return;

    cameraTarget = { roomId, distance };
    cameraAnimating = true;
}

export function focusOverview() {
    cameraTarget = { mode: "overview" };
    cameraAnimating = true;
}

export function initUniverseScene({ rootId = "universeRoot", onPlanetClick: handler } = {}) {
    if (handler) {
        onPlanetClick = handler;
    }
    const rootElement = document.getElementById(rootId);
    if (rootElement) {
        createRoot(rootElement).render(e(App));
    }
}

function NebulaClouds() {
    const cloudRef = useRef(null);

    useFrame(() => {
        if (cloudRef.current) {
            cloudRef.current.rotation.y += 0.00001;
        }
    });

    return e("group", { ref: cloudRef },
        e(Sparkles, {
            count: 200,
            scale: 300,
            size: 5.5,
            speed: 0.5,
            color: "#3aa9ff"
        })
    );
}

function CustomStars() {
    const starsRef = useRef(null);
    const starMeshes = useRef([]);

    useEffect(() => {
        if (!starsRef.current) return;

        const group = starsRef.current;
        const starCount = 10000;

        for (let i = 0; i < starCount; i++) {
            const phi = Math.acos(-1 + (2 * i) / starCount);
            const theta = Math.sqrt(starCount * Math.PI) * phi;

            const radius = 250 + Math.random() * 150;
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            const size = 0.08 + Math.random() * 0.18;
            const brightness = 0.35 + Math.random() * 0.65;
            const hue = 0.55 + Math.random() * 0.25;

            const geometry = new THREE.SphereGeometry(size, 3, 3);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(hue, 0.7, brightness),
                transparent: true,
                opacity: brightness * 0.9,
                depthWrite: false
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            mesh.renderOrder = -1000;
            group.add(mesh);
            starMeshes.current.push({ mesh, brightness, seed: Math.random() });
        }
    }, []);

    useFrame(({ clock }) => {
        if (starsRef.current) {
            starMeshes.current.forEach((star) => {
                const t = clock.elapsedTime * 0.7 + star.seed * 6.28;
                const twinkle = Math.sin(t) * 0.4 + 0.6;
                star.mesh.material.opacity = star.brightness * 0.9 * twinkle;
            });
        }
    });

    return e("group", { ref: starsRef });
}

function Planet({ index = 0, size = 3, color = "#3aa9ff", roomId }) {
    const groupRef = useRef(null);
    const planetRef = useRef(null);
    const ringPivotRef = useRef(null);
    const ringRef = useRef(null);
    const ringGlowRef = useRef(null);
    const [hovered, setHovered] = useState(false);
    const planet = planets.find(p => p.roomId === roomId) || { roomId, roomName: roomId, status: "offline", users: 0, maxUsers: 0, isPrivate: false };

    useFrame(({ clock }) => {
        if (groupRef.current) {
            const nextPosition = getPlanetWorldPositionByIndex(index, clock.elapsedTime);
            if (nextPosition) {
                groupRef.current.position.lerp(nextPosition, 0.08);
            }
        }
        if (planetRef.current) {
            planetRef.current.rotation.y += 0.0032 + index * 0.00025;
            planetRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.18 + index * 0.7) * 0.08;
        }
        if (ringPivotRef.current) {
            ringPivotRef.current.rotation.y = clock.elapsedTime * (0.32 + index * 0.03);
            ringPivotRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.4 + index) * 0.12;
            ringPivotRef.current.rotation.z = Math.cos(clock.elapsedTime * 0.28 + index * 0.6) * 0.18;
        }
        if (ringRef.current) {
            ringRef.current.rotation.z += 0.004 + index * 0.0003;
        }
        if (ringGlowRef.current) {
            ringGlowRef.current.rotation.z -= 0.0025 + index * 0.0002;
        }
        if (groupRef.current && hovered) {
            groupRef.current.scale.lerp(new THREE.Vector3(size * 1.25, size * 1.25, size * 1.25), 0.1);
        } else if (groupRef.current) {
            groupRef.current.scale.lerp(new THREE.Vector3(size, size, size), 0.1);
        }
    });

    const handleClick = () => {
        if (onPlanetClick) {
            onPlanetClick(roomId);
        }
    };

    return e("group", {
        ref: groupRef,
        position: getPlanetWorldPositionByIndex(index)?.toArray() || [0, 0, 0],
        onClick: handleClick,
        onPointerOver: () => setHovered(true),
        onPointerOut: () => setHovered(false)
    },
        e("mesh", { ref: planetRef },
            e("sphereGeometry", { args: [1, 48, 48] }),
            e("meshStandardMaterial", {
                color,
                emissive: color,
                emissiveIntensity: hovered ? 1.5 : 0.7,
                roughness: 0.3,
                metalness: 0.2
            })
        ),
        e("mesh", { scale: 1.15 },
            e("sphereGeometry", { args: [1, 32, 32] }),
            e("meshBasicMaterial", {
                color,
                transparent: true,
                opacity: hovered ? 0.3 : 0.15,
                side: THREE.BackSide
            })
        ),
        e("group", { ref: ringPivotRef },
            e("mesh", { ref: ringRef, rotation: [Math.PI / 2.2, 0, 0] },
                e("torusGeometry", { args: [1.55, 0.08, 18, 96] }),
                e("meshStandardMaterial", {
                    color,
                    transparent: true,
                    opacity: hovered ? 0.82 : 0.62,
                    emissive: color,
                    emissiveIntensity: hovered ? 0.6 : 0.35,
                    roughness: 0.38,
                    metalness: 0.42
                })
            ),
            e("mesh", { ref: ringGlowRef, rotation: [Math.PI / 2.2, 0, 0], scale: [1.06, 1.06, 1.06] },
                e("torusGeometry", { args: [1.55, 0.03, 12, 96] }),
                e("meshBasicMaterial", {
                    color,
                    transparent: true,
                    opacity: hovered ? 0.38 : 0.2
                })
            )
        ),
        e("pointLight", {
            intensity: hovered ? 2 : 1,
            distance: 15,
            color,
            decay: 2
        }),
        hovered ? e(Html, { position: [0, 2.1, 0], center: true, distanceFactor: 16, transform: true, sprite: true, zIndexRange: [120, 0] },
            e("div", { className: "planet-tooltip" },
                e("div", { className: "planet-tooltip-title" }, planet.roomName || planet.roomId),
                e("div", { className: "planet-tooltip-meta" }, `${planet.status || "offline"} • ${planet.users || 0}/${planet.maxUsers || 0} users`),
                e("div", { className: "planet-tooltip-meta" }, planet.isPrivate ? "🔒 Private" : "🔓 Public")
            )
        ) : null
    );
}

function UniverseScene() {
    const { camera } = useThree();
    const controlsRef = useRef(null);
    const overviewAppliedRef = useRef(false);
    const overviewTargetRef = useRef(new THREE.Vector3());

    useEffect(() => {
        if (!controlsRef.current || overviewAppliedRef.current) return;

        const overview = getOverviewCameraState(camera);
        camera.position.copy(overview.position);
        controlsRef.current.target.copy(overview.target);
        controlsRef.current.maxDistance = overview.maxDistance;
        controlsRef.current.update();
        overviewTargetRef.current.copy(overview.target);
        overviewAppliedRef.current = true;
    }, [camera]);

    useFrame(({ clock }) => {
        if (!controlsRef.current) return;

        const controls = controlsRef.current;
        const elapsedTime = clock.elapsedTime;

        if (cameraAnimating && cameraTarget) {
            let targetPos = null;
            let goalPos = null;

            if (cameraTarget.mode === "overview") {
                const overview = getOverviewCameraState(camera);
                overviewTargetRef.current.copy(overview.target);
                targetPos = overview.target;
                goalPos = overview.position;
                controls.maxDistance = overview.maxDistance;
            } else {
                targetPos = getPlanetWorldPosition(cameraTarget.roomId, elapsedTime);
                if (!targetPos) {
                    cameraAnimating = false;
                    return;
                }
                goalPos = targetPos.clone().addScaledVector(CAMERA_DIRECTION, cameraTarget.distance);
            }

            camera.position.lerp(goalPos, 0.08);
            controls.target.lerp(targetPos, 0.1);
            controls.autoRotate = false;
            controls.update();

            if (
                camera.position.distanceTo(goalPos) < 0.2 &&
                controls.target.distanceTo(targetPos) < 0.15
            ) {
                camera.position.copy(goalPos);
                controls.target.copy(targetPos);
                controls.autoRotate = autoRotateEnabled;
                controls.update();
                cameraAnimating = false;
            }

            return;
        }

        if (selectedPlanetId) {
            const selectedPosition = getPlanetWorldPosition(selectedPlanetId, elapsedTime);
            if (selectedPosition) {
                const previousTarget = controls.target.clone();
                controls.target.lerp(selectedPosition, 0.08);
                camera.position.add(controls.target.clone().sub(previousTarget));
            }
            controls.autoRotate = autoRotateEnabled;
            controls.autoRotateSpeed = -0.35;
        } else {
            const overviewDrift = new THREE.Vector3(
                Math.sin(elapsedTime * 0.09) * 3.2,
                Math.sin(elapsedTime * 0.13) * 1.4,
                Math.cos(elapsedTime * 0.08) * 2.8
            );
            const desiredTarget = overviewTargetRef.current.clone().add(overviewDrift);
            controls.target.lerp(desiredTarget, 0.015);
            controls.autoRotate = autoRotateEnabled;
            controls.autoRotateSpeed = -0.18;
        }

        controls.update();
    });

    return e(React.Fragment, null,
        e("ambientLight", { intensity: 0.6, color: "#1a3a52" }),
        e("pointLight", { position: [0, 80, 0], intensity: 2, color: "#ffffff", distance: 300 }),
        e("pointLight", { position: [50, 40, 50], intensity: 1.2, color: "#3aa9ff", distance: 200, decay: 1.5 }),
        e(NebulaClouds),
        e(CustomStars),

        planets.slice(0, 8).map((planet, i) => {
            const hues = [0.55, 0.6, 0.65, 0.58, 0.62, 0.57, 0.63, 0.59];
            const color = planet.accentColor || `hsl(${hues[i] * 360}, 85%, 55%)`;
            return e(Planet, {
                key: planet.roomId,
                index: i,
                size: PLANET_SIZES[i] || 3,
                color,
                roomId: planet.roomId
            });
        }),

        e(OrbitControls, {
            ref: controlsRef,
            enablePan: true,
            enableZoom: true,
            minDistance: 18,
            maxDistance: 240,
            autoRotate: autoRotateEnabled,
            enableDamping: true,
            dampingFactor: 0.08,
            rotateSpeed: 0.6
        })
    );
}

function App() {
    return e(Canvas, {
        camera: { position: [0, 60, 40], fov: 55, far: 2000 },
        dpr: Math.min(window.devicePixelRatio, 2)
    }, e(UniverseScene));
}
