import { useState, useEffect, useRef, useMemo } from "react";
import SunCalc from "suncalc";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import logo from "../assets/logo2.png";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Sun,
  MapPin,
  Calendar,
  Clock,
  Compass,
  ChevronDown,
  Target,
  RefreshCw,
  Globe,
  Settings,
  Moon,
  XCircle,
  Camera,
  Sunrise,
  Sunset,
  RotateCw,
  Crosshair,
  ExternalLink,
  Send,
} from "lucide-react";
// Firebase Imports
import { ref, set } from "firebase/database";
import { db } from "../db/firebase";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REV = "https://nominatim.openstreetmap.org/reverse";
const TIMEAPI = "https://timeapi.io/api/TimeZone/coordinate";
const PHOTON = "https://photon.komoot.io/api/"; // autocomplete geocoder (OpenStreetMap data)

// ─── Inverse Kinematics: Solar position → Motor angles ──────────────────────
function solarToMotorAngles(azimuthDeg, elevationDeg) {
  const A = (azimuthDeg * Math.PI) / 180;
  const h = (elevationDeg * Math.PI) / 180;

  const X = Math.cos(h) * Math.sin(A);
  const Y = Math.cos(h) * Math.cos(A);
  const Z = Math.sin(h);

  const carriage = (Math.acos(Math.max(-1, Math.min(1, X))) * 180) / Math.PI;

  let arc;
  if (Math.abs(Y) < 1e-10 && Math.abs(Z) < 1e-10) {
    arc = 90.0;
  } else {
    arc = 90 + (Math.atan2(-Y, Z) * 180) / Math.PI;
  }
  return { arc, carriage };
}

// ─── Sun appearance based on altitude (day → sunset → below horizon) ────────
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function getSunLook(altDeg) {
  const dayColor = new THREE.Color(0xfbbf24); // bright yellow
  const lowColor = new THREE.Color(0xff5a1f); // sunset orange-red
  const darkColor = new THREE.Color(0x4a1d0a); // dim ember (below horizon)

  let color;
  if (altDeg > 0) {
    // 0° → orange-red, 20°+ → full yellow
    color = lowColor.clone().lerp(dayColor, clamp01(altDeg / 20));
  } else {
    // 0° → orange-red, -6° and below → dark
    color = darkColor.clone().lerp(lowColor, clamp01((altDeg + 6) / 6));
  }

  // overall brightness: 1 in full day, fades near horizon, very low below it
  const brightness = Math.max(0.08, Math.min(1, (altDeg + 6) / 26));

  return { color, brightness };
}

// ─── Mechanism Scene: Apartment + Arc + Carriage ────────────
function MechanismScene({ arcAngle, carriageAngle, sunAltitude = 45 }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth,
      H = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.04);

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
    camera.position.set(7.5, 5.5, 9.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.set(0, 1.4, 0);
    controls.minDistance = 3;
    controls.maxDistance = 25;
    controls.maxPolarAngle = Math.PI * 0.495;

    // ── Lights ──
    scene.add(new THREE.AmbientLight(0x4466aa, 1.1));
    const key = new THREE.DirectionalLight(0xaaccff, 1.2);
    key.position.set(5, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    scene.add(key);

    // ── Ground ──
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(8, 64),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.95,
        metalness: 0.05,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(16, 32, 0x334155, 0x1e293b);
    grid.position.y = 0.005;
    scene.add(grid);

    // ─── DETAILED 3D APARTMENT BUILDING ───
    const apt = new THREE.Group();
    apt.scale.set(0.45, 0.45, 0.45);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.85,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 3.0, 2.0), bodyMat);
    body.position.y = 1.5;
    body.castShadow = true;
    body.receiveShadow = true;
    apt.add(body);

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.9,
    });
    const stairExit = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.6, 0.8),
      roofMat,
    );
    stairExit.position.set(-0.4, 3.3, -0.4);
    stairExit.castShadow = true;
    apt.add(stairExit);

    const hvac = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 1.0), roofMat);
    hvac.position.set(0.5, 3.2, 0.4);
    hvac.castShadow = true;
    apt.add(hvac);

    const parapetMat = new THREE.MeshStandardMaterial({ color: 0x64748b });
    const pTop = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.15, 0.1),
      parapetMat,
    );
    pTop.position.set(0, 3.05, 1.0);
    apt.add(pTop);
    const pBot = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.15, 0.1),
      parapetMat,
    );
    pBot.position.set(0, 3.05, -1.0);
    apt.add(pBot);
    const pLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, 2.1),
      parapetMat,
    );
    pLeft.position.set(-1.0, 3.05, 0);
    apt.add(pLeft);
    const pRight = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, 2.1),
      parapetMat,
    );
    pRight.position.set(1.0, 3.05, 0);
    apt.add(pRight);

    const winMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.5,
    });

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.8, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.5,
        metalness: 0.3,
      }),
    );
    door.position.set(0, 0.4, 1.01);
    apt.add(door);

    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.05, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6 }),
    );
    awning.position.set(0, 0.9, 1.15);
    apt.add(awning);

    [-0.6, 0.6].forEach((x) => {
      [1.3, 2.1].forEach((y) => {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), winMat);
        w.position.set(x, y, 1.01);
        apt.add(w);
      });
    });

    const stairMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.6,
      roughness: 0.4,
    });
    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 3.0, 0.2),
      stairMat,
    );
    spine.position.set(0.6, 1.5, -1.1);
    apt.add(spine);

    [0.5, 1.5, 2.5].forEach((y) => {
      const landing = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.05, 0.4),
        stairMat,
      );
      landing.position.set(0.2, y, -1.1);
      landing.castShadow = true;
      apt.add(landing);
    });

    [-0.6].forEach((x) => {
      [1.3, 2.1].forEach((y) => {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), winMat);
        w.position.set(x, y, -1.01);
        apt.add(w);
      });
    });

    const balconyMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });
    [0.8, 1.8, 2.8].forEach((y) => {
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.1, 1.2),
        balconyMat,
      );
      floor.position.set(-1.2, y, 0);
      floor.castShadow = true;
      apt.add(floor);

      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.3, 1.2),
        stairMat,
      );
      rail.position.set(-1.4, y + 0.15, 0);
      apt.add(rail);

      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.8), winMat);
      w.position.set(-1.01, y + 0.25, 0);
      apt.add(w);
    });

    const billboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 1.8, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.9 }),
    );
    billboard.position.set(1.01, 1.8, 0);
    apt.add(billboard);

    [0.6, -0.6].forEach((z) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.3), winMat);
      w.position.set(1.01, 2.7, z);
      apt.add(w);
    });

    scene.add(apt);

    // ── Semicircular Arc ──
    const ARC_R = 3.5;
    const arcGroup = new THREE.Group();

    const arcCurve = new THREE.Curve();
    arcCurve.getPoint = (t) => {
      const a = t * Math.PI;
      return new THREE.Vector3(Math.cos(a) * ARC_R, Math.sin(a) * ARC_R, 0);
    };
    const arcTube = new THREE.Mesh(
      new THREE.TubeGeometry(arcCurve, 96, 0.05, 10, false),
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.7,
        roughness: 0.25,
      }),
    );
    arcTube.castShadow = true;
    arcGroup.add(arcTube);

    const rawTheta = arcAngle - 90;
    const clampedTheta = Math.max(-90, Math.min(90, rawTheta));
    const thetaRad = (clampedTheta * Math.PI) / 180;

    arcGroup.rotation.x = thetaRad;
    arcGroup.position.y = 0.1;

    scene.add(arcGroup);

    // ── Sun look (day / sunset / below horizon) ──
    const { color: sunColor, brightness } = getSunLook(sunAltitude);

    // ── Carriage on the arc ──
    const localAngle = Math.PI - (carriageAngle * Math.PI) / 180;
    const localPos = new THREE.Vector3(
      Math.cos(localAngle) * ARC_R,
      Math.sin(localAngle) * ARC_R,
      0,
    );
    const carPos = localPos
      .clone()
      .applyEuler(arcGroup.rotation)
      .add(arcGroup.position);

    const carriage = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 24, 24),
      new THREE.MeshStandardMaterial({
        color: sunColor,
        emissive: sunColor,
        emissiveIntensity: 0.3 + 1.7 * brightness,
        metalness: 0.3,
        roughness: 0.3,
      }),
    );
    carriage.position.copy(carPos);
    carriage.castShadow = true;
    scene.add(carriage);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 20, 20),
      new THREE.MeshBasicMaterial({
        color: sunColor,
        transparent: true,
        opacity: 0.16 * brightness,
        depthWrite: false,
      }),
    );
    glow.position.copy(carPos);
    scene.add(glow);

    const sunLight = new THREE.PointLight(sunColor, 5 * brightness, 12, 1.6);
    sunLight.position.copy(carPos);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(512, 512);
    scene.add(sunLight);

    const rayPts = [carPos.clone(), new THREE.Vector3(0, 1.0, 0)];
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(rayPts),
      new THREE.LineDashedMaterial({
        color: sunColor,
        dashSize: 0.15,
        gapSize: 0.1,
        transparent: true,
        opacity: 0.25 + 0.5 * brightness,
      }),
    );
    ray.computeLineDistances();
    scene.add(ray);

    // ── Compass labels ──
    const makeLabel = (text, x, z, color = "#94a3b8") => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.font = "bold 38px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true }),
      );
      sprite.position.set(x, 0.25, z);
      sprite.scale.set(0.8, 0.8, 1);
      scene.add(sprite);
    };
    makeLabel("N", 0, -4.5);
    makeLabel("S", 0, 4.5);
    makeLabel("E", 4.5, 0);
    makeLabel("W", -4.5, 0);

    let frame;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    camera.lookAt(0, 1.4, 0);

    const onResize = () => {
      const W2 = el.clientWidth,
        H2 = el.clientHeight;
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
      renderer.setSize(W2, H2);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [arcAngle, carriageAngle, sunAltitude]);

  return (
    <div style={{ position: "relative", height: "100%", minHeight: "400px" }}>
      <div
        ref={mountRef}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #334155",
        }}
      />

      {/* Overlay inside the graphic window */}
      <div
        className="position-absolute top-0 start-0 m-3 p-3 bg-dark text-light rounded shadow-lg"
        style={{
          backgroundColor: "rgba(15, 23, 42, 0.85)",
          border: "1px solid #475569",
          fontFamily: "'Courier New', monospace",
          fontSize: "13px",
          pointerEvents: "none",
          backdropFilter: "blur(4px)",
          lineHeight: "1.6",
        }}
      >
        <div>
          <span style={{ color: "#7dd3fc", fontWeight: "bold" }}>
            {arcAngle.toFixed(2)}°
          </span>{" "}
          Arc Angle
        </div>
        <div style={{ color: "#94a3b8", fontSize: "10px" }}>
          arc rotation motor
        </div>
        <div className="mt-2">
          <span style={{ color: "#fcd34d", fontWeight: "bold" }}>
            {carriageAngle.toFixed(2)}°
          </span>{" "}
          Carriage Angle
        </div>
        <div style={{ color: "#94a3b8", fontSize: "10px" }}>carriage motor</div>
      </div>
    </div>
  );
}

// ─── Mechanism Legend ───────────────────────────────────────────────────────
function MechanismLegend() {
  return (
    <div className="d-flex flex-wrap justify-content-center gap-3 mt-3">
      {[
        { color: "#94a3b8", label: "Semicircular arc" },
        { color: "#fbbf24", label: "Carriage / sun" },
        { color: "#e2e8f0", label: "Apartment" },
        { color: "#fbbf24", label: "Sun ray" },
      ].map(({ color, label }) => (
        <div key={label} className="d-flex align-items-center gap-2">
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: color,
            }}
          />
          <span className="text-secondary" style={{ fontSize: 11 }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ViewControls({ onResetView }) {
  return (
    <div className="position-absolute top-0 end-0 m-3 z-3">
      <button
        onClick={onResetView}
        className="btn btn-sm btn-dark border border-secondary d-flex align-items-center gap-2 px-3 py-2"
        style={{
          backgroundColor: "rgba(15, 23, 42, 0.8)",
          backdropFilter: "blur(4px)",
          fontSize: "11px",
        }}
      >
        <Camera size={14} /> Reset Camera
      </button>
    </div>
  );
}

// ─── Compact Data Row Component ─────────────────────────────────────────────
const DataRow = ({ icon, label, value, sub, accent = "#3b82f6", isLast }) => (
  <div
    className={`d-flex align-items-center justify-content-between py-2 ${!isLast ? "border-bottom" : ""}`}
  >
    <div className="d-flex align-items-center gap-3">
      <div style={{ color: accent }}>{icon}</div>
      <div className="d-flex flex-column">
        <span className="text-secondary fw-semibold" style={{ fontSize: 13 }}>
          {label}
        </span>
        {sub && (
          <span className="text-muted" style={{ fontSize: 11 }}>
            {sub}
          </span>
        )}
      </div>
    </div>
    <div
      className="text-dark fw-bold"
      style={{ fontSize: 16, fontFamily: "monospace" }}
    >
      {value}
    </div>
  </div>
);

// ─── Timezone helpers ───────────────────────────────────────────────────────
const makeTzFmt = (tz) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const tzParts = (fmt, ms) => {
  const p = {};
  fmt.formatToParts(ms).forEach((x) => {
    p[x.type] = x.value;
  });
  return p;
};

// offset (ms) of the timezone from UTC at a given instant
const tzOffsetMs = (fmt, ms) => {
  const p = tzParts(fmt, ms);
  return (
    Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour % 24,
      +p.minute,
      +p.second,
    ) - ms
  );
};

// minutes since local midnight for a Date, in the given timezone
const localMinutesOfDay = (fmt, date) => {
  if (!date || !isFinite(date)) return null;
  const p = tzParts(fmt, date.getTime());
  return (+p.hour % 24) * 60 + +p.minute;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const pad2 = (n) => String(n).padStart(2, "0");
const fmtHM = (mins) => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
const fmtDate = (d) =>
  `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
const fmtTime12 = (t) => {
  const h = t.getHours(),
    m = t.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
};

// Band colours: index = 0 night, 1 astronomical, 2 nautical, 3 civil, 4 day
const BAND_COLORS = ["#04112b", "#0b3a73", "#2a6cb0", "#6ea6e0", "#b7d4ff"];
const bandOf = (altDeg) =>
  altDeg > -0.833
    ? 4
    : altDeg > -6
      ? 3
      : altDeg > -12
        ? 2
        : altDeg > -18
          ? 1
          : 0;

const ROWS = 144; // 10-minute rows for the background bands

// ─── Day-Length Chart (date + time picker) ──────────────────────────────────
function DayLengthChart({ geo, date, time, onChange, onCommit, onYearChange }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const bgRef = useRef(null);
  const dragging = useRef(false);
  const pending = useRef({ d: date, t: time });
  const [width, setWidth] = useState(0);
  const [bgTick, setBgTick] = useState(0);

  const HEIGHT = 260;
  const M = { left: 22, right: 6, top: 6, bottom: 18 };
  const year = date.getFullYear();
  const daysInYear =
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;

  const fmt = useMemo(() => makeTzFmt(geo.tz), [geo.tz]);

  // keep canvas width in sync with container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── Band classification grid: only recomputed when location or year changes ──
  const grid = useMemo(() => {
    const g = new Uint8Array(daysInYear * ROWS);
    for (let d = 0; d < daysInYear; d++) {
      const offset = tzOffsetMs(fmt, Date.UTC(year, 0, 1 + d, 12, 0));
      const base = Date.UTC(year, 0, 1 + d, 0, 0) - offset;
      for (let r = 0; r < ROWS; r++) {
        const utc = new Date(base + (r * 10 + 5) * 60000);
        const alt =
          (SunCalc.getPosition(utc, geo.lat, geo.lon).altitude * 180) / Math.PI;
        g[d * ROWS + r] = bandOf(alt);
      }
    }
    return g;
  }, [fmt, geo.lat, geo.lon, year, daysInYear]);

  // ── Paint the static background (bands + grid + labels) to an offscreen canvas ──
  useEffect(() => {
    if (!width) return;
    const dpr = window.devicePixelRatio || 1;
    const off = document.createElement("canvas");
    off.width = width * dpr;
    off.height = HEIGHT * dpr;
    const ctx = off.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, HEIGHT);

    const cw = plotW / daysInYear;
    const ch = plotH / ROWS;

    // bands (merge runs of equal class in each column)
    for (let d = 0; d < daysInYear; d++) {
      let runStart = 0;
      for (let r = 1; r <= ROWS; r++) {
        if (r === ROWS || grid[d * ROWS + r] !== grid[d * ROWS + runStart]) {
          ctx.fillStyle = BAND_COLORS[grid[d * ROWS + runStart]];
          ctx.fillRect(
            M.left + d * cw,
            M.top + runStart * ch,
            cw + 0.6,
            (r - runStart) * ch + 0.6,
          );
          runStart = r;
        }
      }
    }

    // month grid lines + labels
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let m = 0; m < 12; m++) {
      const start = Math.round(
        (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 864e5,
      );
      const end = Math.round(
        (Date.UTC(year, m + 1, 1) - Date.UTC(year, 0, 1)) / 864e5,
      );
      const x = M.left + start * cw;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, M.top);
      ctx.lineTo(x, M.top + plotH);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.fillText(MONTHS[m], M.left + ((start + end) / 2) * cw, HEIGHT - 5);
    }

    // hour grid lines + labels
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let h = 0; h < 24; h++) {
      const y = M.top + (h / 24) * plotH;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.moveTo(M.left, y);
      ctx.lineTo(M.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.fillText(pad2(h), M.left - 4, M.top + ((h + 0.5) / 24) * plotH);
    }

    bgRef.current = off;
    setBgTick((n) => n + 1);
  }, [grid, width, plotW, plotH, daysInYear, year]);

  // ── Paint background + selection markers ──
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !width || !bgRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = HEIGHT * dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bgRef.current, 0, 0, width, HEIGHT);

    const cw = plotW / daysInYear;
    const doy = Math.floor(
      (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 1)) /
        864e5,
    );
    const mins = time.getHours() * 60 + time.getMinutes();
    const x = M.left + (doy + 0.5) * cw;
    const y = M.top + (mins / 1440) * plotH;

    // sunrise / sunset of the selected day
    const offset = tzOffsetMs(
      fmt,
      Date.UTC(year, date.getMonth(), date.getDate(), 12, 0),
    );
    const noon = new Date(
      Date.UTC(year, date.getMonth(), date.getDate(), 12, 0) - offset,
    );
    const times = SunCalc.getTimes(noon, geo.lat, geo.lon);
    const rise = localMinutesOfDay(fmt, times.sunrise);
    const set = localMinutesOfDay(fmt, times.sunset);

    // crosshair
    ctx.save();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, M.top);
    ctx.lineTo(x, M.top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(M.left, y);
    ctx.lineTo(M.left + plotW, y);
    ctx.stroke();
    ctx.restore();

    // sunrise / sunset markers
    ctx.font = "11px Inter, sans-serif";
    ctx.textBaseline = "middle";
    [rise, set].forEach((m) => {
      if (m === null) return;
      const my = M.top + (m / 1440) * plotH;
      ctx.beginPath();
      ctx.arc(x, my, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#ef4444";
      ctx.stroke();
      const flip = x > width - 50;
      ctx.textAlign = flip ? "right" : "left";
      ctx.fillStyle = "#ef4444";
      ctx.fillText(fmtHM(m), flip ? x - 6 : x + 6, my + (m < 720 ? 7 : -7));
    });

    // selected point
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#dc2626";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [
    bgTick,
    date,
    time,
    geo.lat,
    geo.lon,
    fmt,
    width,
    plotW,
    plotH,
    daysInYear,
    year,
  ]);

  // ── Pointer interaction ──
  const pick = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left - M.left) / plotW));
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top - M.top) / plotH));
    const doy = Math.min(daysInYear - 1, Math.floor(fx * daysInYear));
    const mins = Math.min(1435, Math.round((fy * 1440) / 5) * 5);
    const d = new Date(year, 0, 1 + doy);
    const t = new Date(year, 0, 1, Math.floor(mins / 60), mins % 60);
    pending.current = { d, t };
    onChange(d, t);
  };

  const onPointerDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(e);
  };
  const onPointerMove = (e) => {
    if (dragging.current) pick(e);
  };
  const endDrag = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    onCommit(pending.current.d, pending.current.t);
  };

  return (
    <div>
      {/* Readout + year controls */}
      <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
        <div
          className="d-flex align-items-center gap-3 text-secondary"
          style={{ fontSize: 13 }}
        >
          <span className="d-flex align-items-center gap-1">
            <Calendar size={14} />{" "}
            <strong className="text-dark">{fmtDate(date)}</strong>
          </span>
          <span className="d-flex align-items-center gap-1">
            <Clock size={14} />{" "}
            <strong className="text-dark">{fmtTime12(time)}</strong>
          </span>
        </div>
        <div className="btn-group btn-group-sm" role="group" aria-label="Year">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => onYearChange(-1)}
          >
            ‹
          </button>
          <span
            className="btn btn-light disabled fw-semibold"
            style={{ minWidth: 56 }}
          >
            {year}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => onYearChange(1)}
          >
            ›
          </button>
        </div>
      </div>

      {/* Chart */}
      <div
        ref={wrapRef}
        style={{
          width: "100%",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid #cbd5e1",
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            width: "100%",
            height: HEIGHT,
            display: "block",
            cursor: "crosshair",
            touchAction: "none",
          }}
        />
      </div>

      {/* Band legend */}
      <div className="d-flex flex-wrap gap-3 mt-2">
        {[
          ["Day", 4],
          ["Civil", 3],
          ["Nautical", 2],
          ["Astronomical", 1],
          ["Night", 0],
        ].map(([label, i]) => (
          <div key={label} className="d-flex align-items-center gap-1">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: BAND_COLORS[i],
                border: "1px solid #cbd5e1",
              }}
            />
            <span className="text-secondary" style={{ fontSize: 11 }}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <div className="text-muted mt-1" style={{ fontSize: 11 }}>
        Click or drag on the chart to choose date (x-axis) and time (y-axis).
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function SunCalculator() {
  const [place, setPlace] = useState("");
  const [useCoords, setUseCoords] = useState(false); // false = place name, true = lat/lon
  const [timeMode, setTimeMode] = useState("picker"); // "picker" (default) | "chart"
  const [latInput, setLatInput] = useState("");
  const [lonInput, setLonInput] = useState("");
  const [geo, setGeo] = useState(null); // { query, lat, lon, tz, displayName }
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(new Date());
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetMechTrigger, setResetMechTrigger] = useState(0);

  // ── Send to machine (Firebase Realtime DB) ──
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null); // { type: "success" | "error", msg }

  // Auto-hide the toast after 3 seconds
  useEffect(() => {
    if (!sendStatus) return;
    const t = setTimeout(() => setSendStatus(null), 3000);
    return () => clearTimeout(t);
  }, [sendStatus]);

  // Google Maps copies coordinates as "12.9716, 77.5946".
  // Pasting that into the Latitude box fills both fields.
  const handleLatChange = (v) => {
    const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      setLatInput(m[1]);
      setLonInput(m[2]);
    } else {
      setLatInput(v);
    }
  };

  // ── Place autocomplete ──
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const selectedRef = useRef(null); // { label, lat, lon } of the chosen suggestion

  useEffect(() => {
    const q = place.trim();
    if (!showSugg || q.length < 1) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lang=en`,
          { signal: ctrl.signal },
        );
        const data = await res.json();
        const seen = new Set();
        const list = (data.features || [])
          .map((f) => {
            const p = f.properties || {};
            const parts = [p.name, p.county || p.district, p.state, p.country]
              .filter(Boolean)
              .filter((x, i, a) => a.indexOf(x) === i);
            return {
              label: parts.join(", "),
              main: p.name || parts[0],
              sub: parts.slice(1).join(", "),
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
            };
          })
          .filter((x) => x.label && !seen.has(x.label) && seen.add(x.label));
        setSuggestions(list);
        setActiveIdx(-1);
      } catch (e) {
        if (e.name !== "AbortError") setSuggestions([]);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [place, showSugg]);

  const pickSuggestion = (sg) => {
    selectedRef.current = sg;
    setPlace(sg.label);
    setShowSugg(false);
    setSuggestions([]);
    setActiveIdx(-1);
  };

  const getLatLng = async (placeName) => {
    const res = await fetch(
      `${NOMINATIM}?format=json&q=${encodeURIComponent(placeName)}&limit=1`,
    );
    const data = await res.json();
    if (!data.length)
      throw new Error("Place not found. Try a more specific name.");
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };
  };

  // Coordinates → readable place name (falls back to the raw numbers)
  const reverseName = async (lat, lon) => {
    try {
      const res = await fetch(
        `${NOMINATIM_REV}?format=json&zoom=10&lat=${lat}&lon=${lon}`,
      );
      const data = await res.json();
      if (data.display_name) return data.display_name;
    } catch {
      /* fall through */
    }
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  };

  const getTimezone = async (lat, lon) => {
    try {
      const res = await fetch(`${TIMEAPI}?latitude=${lat}&longitude=${lon}`);
      const data = await res.json();
      return data.timeZone;
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  };

  const localToUTC = (dateObj, timeObj, tz) => {
    const [year, month, day] = [
      dateObj.getFullYear(),
      dateObj.getMonth(),
      dateObj.getDate(),
    ];
    const [hour, minute] = [timeObj.getHours(), timeObj.getMinutes()];
    const roughUTC = Date.UTC(year, month, day, hour, minute);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(roughUTC).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
    const tzMs = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour % 24,
      +parts.minute,
    );
    return new Date(roughUTC + (roughUTC - tzMs));
  };

  const toDeg = (rad) => rad * (180 / Math.PI);

  // Pure calculation for an already-resolved location + chosen date/time
  const compute = (g, dateObj, timeObj) => {
    const { lat, lon, tz, displayName } = g;
    const utc = localToUTC(dateObj, timeObj, tz);
    const pos = SunCalc.getPosition(utc, lat, lon);

    const altitude = toDeg(pos.altitude);
    const azimuth = (toDeg(pos.azimuth) + 180) % 360;
    const zenith = 90 - altitude;

    const motor = solarToMotorAngles(azimuth, altitude);

    const times = SunCalc.getTimes(utc, lat, lon);
    const fmtTime = (d) => {
      if (!isFinite(d)) return "N/A";
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(d);
    };

    setResult({
      place: displayName.split(",").slice(0, 2).join(", "),
      lat: lat.toFixed(5),
      lon: lon.toFixed(5),
      tz,
      altitude: altitude.toFixed(3),
      zenith: zenith.toFixed(3),
      azimuth: azimuth.toFixed(3),
      arcAngle: motor.arc.toFixed(2),
      carriageAngle: motor.carriage.toFixed(2),
      sunrise: fmtTime(times.sunrise),
      sunset: fmtTime(times.sunset),
      isAboveHorizon: altitude > 0,
      utcISO: utc.toISOString(),
    });
  };

  const calculate = async () => {
    setError("");
    setSendStatus(null);
    setShowSugg(false);
    setSuggestions([]);

    let q;
    let coords = null;

    if (useCoords) {
      const lat = parseFloat(latInput);
      const lon = parseFloat(lonInput);
      if (!isFinite(lat) || !isFinite(lon)) {
        setError("Enter both latitude and longitude.");
        return;
      }
      if (lat < -90 || lat > 90) {
        setError("Latitude must be between -90 and 90.");
        return;
      }
      if (lon < -180 || lon > 180) {
        setError("Longitude must be between -180 and 180.");
        return;
      }
      coords = { lat, lon };
      q = `coords:${lat},${lon}`;
    } else {
      q = place.trim();
      if (!q) {
        setError("Please fill in the place field.");
        return;
      }
    }

    setLoading(true);
    try {
      let g = geo;
      if (!g || g.query !== q) {
        let lat, lon, displayName;
        if (coords) {
          ({ lat, lon } = coords);
          displayName = await reverseName(lat, lon);
        } else {
          const sel = selectedRef.current;
          ({ lat, lon, displayName } =
            sel && sel.label === q
              ? { lat: sel.lat, lon: sel.lon, displayName: sel.label }
              : await getLatLng(q));
        }
        const tz = await getTimezone(lat, lon);
        g = { query: q, lat, lon, tz, displayName };
        setGeo(g);
      }
      compute(g, date, time);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  // ── Send the current motor angles to Firebase Realtime Database ──
  // Writes to: motor/current { arcAngle, carriageAngle, timestamp }
  const sendToMachine = async () => {
    if (!result) return;
    setSending(true);
    setSendStatus(null);
    try {
      await set(ref(db, "motor/current"), {
        arcAngle: parseFloat(result.arcAngle),
        carriageAngle: parseFloat(result.carriageAngle),
        timestamp: new Date().toISOString(),
      });
      setSendStatus({ type: "success", msg: "Sent to machine." });
    } catch (err) {
      setSendStatus({ type: "error", msg: `Send failed: ${err.message}` });
    }
    setSending(false);
  };

  // Chart callbacks
  const handleChartChange = (d, t) => {
    setDate(d);
    setTime(t);
  };
  const handleChartCommit = (d, t) => {
    if (geo) {
      setSendStatus(null);
      compute(geo, d, t);
    }
  };
  const handleYearChange = (delta) => {
    const nd = new Date(
      date.getFullYear() + delta,
      date.getMonth(),
      date.getDate(),
    );
    setDate(nd);
    if (geo) {
      setSendStatus(null);
      compute(geo, nd, time);
    }
  };

  const compassDir = (az) => {
    const dirs = [
      "N",
      "NNE",
      "NE",
      "ENE",
      "E",
      "ESE",
      "SE",
      "SSE",
      "S",
      "SSW",
      "SW",
      "WSW",
      "W",
      "WNW",
      "NW",
      "NNW",
    ];
    return dirs[Math.round(az / 22.5) % 16];
  };

  const handleResetMech = () => setResetMechTrigger((prev) => prev + 1);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f8fafc",
        fontFamily: "'Inter', sans-serif",
        color: "#0f172a",
      }}
    >
      {/* 35% / 65% split on large screens */}
      <style>{`
        @media (min-width: 992px) {
          .row > .split-left  { flex: 0 0 auto; width: 35%; }
          .row > .split-right { flex: 0 0 auto; width: 65%; }
        }
        /* react-datepicker inside Bootstrap input-groups */
        .input-group > .react-datepicker-wrapper { flex: 1 1 auto; width: 1%; min-width: 0; }
        .react-datepicker-popper { z-index: 60 !important; }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Toast (shown for 3 seconds after sending) ── */}
      {sendStatus && (
        <div
          className="position-fixed top-0 end-0 p-3"
          style={{ zIndex: 2000, marginTop: 70 }}
        >
          <div
            className={`toast show align-items-center border-0 text-white ${sendStatus.type === "success" ? "bg-success" : "bg-danger"}`}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{ animation: "toastIn 0.25s ease-out" }}
          >
            <div className="d-flex">
              <div className="toast-body fw-semibold">{sendStatus.msg}</div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                aria-label="Close"
                onClick={() => setSendStatus(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Professional Dark Slate Top Navbar ── */}
      <div
        className="d-flex flex-column flex-md-row align-items-center justify-content-md-between text-center text-md-start px-3 px-md-4 py-3 gap-3 sticky-top"
        style={{
          backgroundColor: "#1e293b", // Dark Slate background
          borderBottom: "1px solid #0f172a",
          zIndex: 100,
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div className="d-flex align-items-center justify-content-center gap-3">
          <div className="p-1 bg-white rounded border-0 shadow-sm">
            <img
              src={logo}
              alt="Logo"
              style={{ height: 36, width: 36, objectFit: "contain" }}
            />
          </div>
          <div className="text-start">
            <div
              className="text-white fw-bold"
              style={{ fontSize: 16, letterSpacing: "-0.5px" }}
            >
              AK Software Developers
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
              Sun Emulation Project
            </div>
          </div>
        </div>

        <div className="d-flex justify-content-center">
          <a
            href="https://aksoftwareco.in/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline-light rounded-pill d-flex align-items-center gap-2 px-3"
          >
            <Globe size={14} /> <span>aksoftwareco.in</span>
          </a>
        </div>
      </div>

      {/* ── Main Layout Container ── */}
      <div className="container-fluid py-4 px-3 px-md-5">
        <div className="row g-4">
          {/* Left Column: Input (35%) */}
          <div className="col-12 split-left">
            {/* Input Card (Bootstrap integrated) */}
            <div
              className="card shadow-sm border-0 rounded-4 h-100"
              style={{ minHeight: "600px" }}
            >
              <div className="card-body p-4">
                <h5 className="card-title fw-bold mb-4 d-flex align-items-center gap-2">
                  <MapPin color="#2563eb" size={20} /> Location & Time
                </h5>

                {/* Input mode toggle */}
                <div className="btn-group btn-group-sm w-100 mb-3" role="group">
                  <button
                    type="button"
                    className={`btn text-nowrap d-flex align-items-center justify-content-center gap-2 ${!useCoords ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => setUseCoords(false)}
                  >
                    <MapPin size={14} /> <span>Place name</span>
                  </button>
                  <button
                    type="button"
                    className={`btn text-nowrap d-flex align-items-center justify-content-center gap-2 ${useCoords ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => setUseCoords(true)}
                  >
                    <Crosshair size={14} />
                    <span className="d-none d-sm-inline">Latitude & Longitude</span>
                    <span className="d-sm-none">Lat & Long</span>
                  </button>
                </div>

                {/* Mode 1: place name with autocomplete */}
                {!useCoords && (
                  <div className="mb-3">
                    <label
                      className="form-label text-secondary fw-semibold"
                      style={{ fontSize: 13 }}
                    >
                      Place
                    </label>
                    <div className="position-relative">
                      <div className="input-group">
                        <span className="input-group-text bg-light text-secondary border-end-0">
                          <MapPin size={16} />
                        </span>
                        <input
                          type="text"
                          className="form-control bg-light border-start-0 ps-0"
                          placeholder="e.g. Dharwad, Karnataka"
                          autoComplete="off"
                          value={place}
                          onChange={(e) => {
                            selectedRef.current = null;
                            setPlace(e.target.value);
                            setShowSugg(true);
                          }}
                          onFocus={() => {
                            if (place.trim()) setShowSugg(true);
                          }}
                          onBlur={() => setShowSugg(false)}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowDown" && suggestions.length) {
                              e.preventDefault();
                              setActiveIdx((i) => (i + 1) % suggestions.length);
                            } else if (
                              e.key === "ArrowUp" &&
                              suggestions.length
                            ) {
                              e.preventDefault();
                              setActiveIdx((i) =>
                                i <= 0 ? suggestions.length - 1 : i - 1,
                              );
                            } else if (e.key === "Escape") {
                              setShowSugg(false);
                            } else if (e.key === "Enter") {
                              if (
                                showSugg &&
                                activeIdx >= 0 &&
                                suggestions[activeIdx]
                              ) {
                                pickSuggestion(suggestions[activeIdx]);
                              } else if (!loading) {
                                calculate();
                              }
                            }
                          }}
                        />
                      </div>

                      {showSugg && suggestions.length > 0 && (
                        <div
                          className="list-group shadow position-absolute w-100 mt-1"
                          style={{
                            zIndex: 50,
                            maxHeight: 260,
                            overflowY: "auto",
                            borderRadius: 8,
                          }}
                          role="listbox"
                        >
                          {suggestions.map((sg, i) => (
                            <button
                              type="button"
                              key={`${sg.label}-${i}`}
                              role="option"
                              aria-selected={i === activeIdx}
                              className={`list-group-item list-group-item-action d-flex align-items-start gap-2 py-2 ${i === activeIdx ? "active" : ""}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                pickSuggestion(sg);
                              }}
                              onMouseEnter={() => setActiveIdx(i)}
                            >
                              <MapPin
                                size={14}
                                className="mt-1 flex-shrink-0"
                              />
                              <span className="d-flex flex-column text-start">
                                <span
                                  className="fw-semibold"
                                  style={{ fontSize: 13 }}
                                >
                                  {sg.main}
                                </span>
                                {sg.sub && (
                                  <span style={{ fontSize: 11, opacity: 0.75 }}>
                                    {sg.sub}
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Mode 2: exact latitude / longitude */}
                {useCoords && (
                  <div className="mb-3">
                    <div className="row g-2">
                      <div className="col-6">
                        <label
                          className="form-label text-secondary fw-semibold"
                          style={{ fontSize: 13 }}
                        >
                          Latitude
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="form-control bg-light"
                          placeholder="e.g. 12.9716"
                          value={latInput}
                          onChange={(e) => handleLatChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !loading) calculate();
                          }}
                        />
                      </div>
                      <div className="col-6">
                        <label
                          className="form-label text-secondary fw-semibold"
                          style={{ fontSize: 13 }}
                        >
                          Longitude
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="form-control bg-light"
                          placeholder="e.g. 77.5946"
                          value={lonInput}
                          onChange={(e) => setLonInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !loading) calculate();
                          }}
                        />
                      </div>
                    </div>

                    <a
                      href={
                        place.trim()
                          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.trim())}`
                          : "https://www.google.com/maps"
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-outline-primary w-100 mt-2 d-flex align-items-center justify-content-center gap-2"
                    >
                      <ExternalLink size={14} /> Open Google Maps
                    </a>

                    <div className="text-muted mt-2" style={{ fontSize: 11 }}>
                      In Google Maps, right-click the exact spot and click the
                      coordinates at the top of the menu to copy them. Then
                      paste them into the Latitude box, and both fields fill in.
                    </div>
                  </div>
                )}

                {/* Date & time: picker (default) or day-length chart */}
                <div className="mb-4">
                  <label
                    className="form-label text-secondary fw-semibold"
                    style={{ fontSize: 13 }}
                  >
                    Date & Time
                  </label>
                  <div className="btn-group btn-group-sm w-100 mb-3" role="group">
                    <button
                      type="button"
                      className={`btn text-nowrap d-flex align-items-center justify-content-center gap-2 ${timeMode === "picker" ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => setTimeMode("picker")}
                    >
                      <Calendar size={14} /> <span>Picker</span>
                    </button>
                    <button
                      type="button"
                      className={`btn text-nowrap d-flex align-items-center justify-content-center gap-2 ${timeMode === "chart" ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => setTimeMode("chart")}
                    >
                      <Sun size={14} />
                      <span className="d-none d-sm-inline">Day-length chart</span>
                      <span className="d-sm-none">Chart</span>
                    </button>
                  </div>

                  {timeMode === "picker" ? (
                    <div className="row g-3">
                      <div className="col-12 col-sm-6">
                        <label
                          className="form-label text-secondary fw-semibold"
                          style={{ fontSize: 13 }}
                        >
                          Date
                        </label>
                        <div className="input-group">
                          <span className="input-group-text bg-light text-secondary border-end-0">
                            <Calendar size={16} />
                          </span>
                          <DatePicker
                            selected={date}
                            onChange={(d) => d && setDate(d)}
                            dateFormat="dd-MM-yyyy"
                            className="form-control bg-light border-start-0 ps-0"
                          />
                        </div>
                      </div>
                      <div className="col-12 col-sm-6">
                        <label
                          className="form-label text-secondary fw-semibold"
                          style={{ fontSize: 13 }}
                        >
                          Time
                        </label>
                        <div className="input-group">
                          <span className="input-group-text bg-light text-secondary border-end-0">
                            <Clock size={16} />
                          </span>
                          <DatePicker
                            selected={time}
                            onChange={(t) => t && setTime(t)}
                            showTimeSelect
                            showTimeSelectOnly
                            timeIntervals={5}
                            timeCaption="Time"
                            dateFormat="h:mm aa"
                            className="form-control bg-light border-start-0 ps-0"
                          />
                        </div>
                      </div>
                    </div>
                  ) : geo ? (
                    <DayLengthChart
                      geo={geo}
                      date={date}
                      time={time}
                      onChange={handleChartChange}
                      onCommit={handleChartCommit}
                      onYearChange={handleYearChange}
                    />
                  ) : (
                    <div
                      className="d-flex flex-column align-items-center justify-content-center text-center text-secondary rounded border bg-light p-4"
                      style={{ minHeight: 160, fontSize: 13 }}
                    >
                      <Clock size={24} className="mb-2 opacity-50" />
                      Enter a place or coordinates and press Calculate to load
                      the day-length chart, then click it to pick the date and
                      time.
                    </div>
                  )}
                </div>

                {error && (
                  <div
                    className="alert alert-danger d-flex align-items-center gap-2 py-2"
                    role="alert"
                  >
                    <XCircle size={16} />{" "}
                    <span style={{ fontSize: 13 }}>{error}</span>
                  </div>
                )}

                <div className="d-flex flex-column flex-sm-row gap-2">
                  <button
                    onClick={calculate}
                    disabled={loading}
                    className="btn btn-primary flex-fill py-2 fw-semibold d-flex justify-content-center align-items-center gap-2"
                    style={{
                      backgroundColor: "#2563eb",
                      borderColor: "#2563eb",
                    }}
                  >
                    {loading ? (
                      "Calculating..."
                    ) : (
                      <>
                        <RotateCw size={18} /> Calculate Position
                      </>
                    )}
                  </button>

                  <button
                    onClick={sendToMachine}
                    disabled={!result || sending}
                    className="btn btn-success flex-fill py-2 fw-semibold d-flex justify-content-center align-items-center gap-2"
                  >
                    {sending ? (
                      "Sending..."
                    ) : (
                      <>
                        <Send size={18} /> Send to Machine
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: 3D Mechanism View (65%) */}
          <div className="col-12 split-right">
            <div
              className="card shadow-sm border-0 rounded-4 h-100"
              style={{ minHeight: "600px" }}
            >
              <div className="card-body p-4 d-flex flex-column position-relative">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <h5 className="fw-bold mb-0 d-flex align-items-center gap-2">
                    <RefreshCw color="#2563eb" size={20} /> Mechanism View
                  </h5>
                  {result && <ViewControls onResetView={handleResetMech} />}
                </div>

                <div
                  className="flex-grow-1 position-relative rounded-4 overflow-hidden"
                  style={{ backgroundColor: "#0f172a" }}
                >
                  {result ? (
                    <MechanismScene
                      key={resetMechTrigger}
                      arcAngle={parseFloat(result.arcAngle)}
                      carriageAngle={parseFloat(result.carriageAngle)}
                      sunAltitude={parseFloat(result.altitude)}
                    />
                  ) : (
                    <div className="d-flex flex-column align-items-center justify-content-center h-100 text-secondary">
                      <Sun size={48} className="mb-3 opacity-50" />
                      <p className="mb-0">
                        Enter location and time to visualize
                      </p>
                    </div>
                  )}
                </div>

                {result && <MechanismLegend />}
              </div>
            </div>
          </div>
        </div>

        {/* ── Info Section: full width, below both cards ── */}
        {result && (
          <div className="card shadow-sm border-0 rounded-4 mt-4 animate__animated animate__fadeIn">
            <div className="card-body p-4">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 pb-3 mb-3 border-bottom">
                <div className="d-flex align-items-center gap-2">
                  <MapPin color="#2563eb" size={18} />
                  <span className="fw-bold text-dark" style={{ fontSize: 15 }}>
                    {result.place}
                  </span>
                </div>
                <div
                  className="d-flex flex-wrap gap-4 text-secondary"
                  style={{ fontSize: 13 }}
                >
                  <div>
                    Lat: <strong>{result.lat}°</strong>
                  </div>
                  <div>
                    Lon: <strong>{result.lon}°</strong>
                  </div>
                  <div>
                    TZ: <strong>{result.tz}</strong>
                  </div>
                  <div>
                    UTC:{" "}
                    <strong>{result.utcISO.split("T")[1].slice(0, 5)}</strong>
                  </div>
                </div>
              </div>

              {parseFloat(result.altitude) <= 0 && (
                <div
                  className="alert alert-warning py-2 mb-3 d-flex align-items-center gap-2"
                  role="alert"
                >
                  <Moon size={16} />{" "}
                  <span style={{ fontSize: 13 }}>
                    Sun is below the horizon.
                  </span>
                </div>
              )}

              {(() => {
                const STEPS_PER_DEG = 100;
                const arcSteps = Math.round(
                  parseFloat(result.arcAngle) * STEPS_PER_DEG,
                );
                const carSteps = Math.round(
                  parseFloat(result.carriageAngle) * STEPS_PER_DEG,
                );
                const tile = "border rounded-3 px-3 bg-light";
                return (
                  <div className="row g-3">
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <DataRow
                          icon={<Compass size={18} />}
                          label="Azimuth"
                          value={`${result.azimuth}°`}
                          sub={compassDir(parseFloat(result.azimuth))}
                          accent="#2563eb"
                          isLast
                        />
                      </div>
                    </div>
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <DataRow
                          icon={<ChevronDown size={18} />}
                          label="Altitude"
                          value={`${result.altitude}°`}
                          sub={
                            result.isAboveHorizon
                              ? "Above horizon"
                              : "Below horizon"
                          }
                          accent="#0ea5e9"
                          isLast
                        />
                      </div>
                    </div>
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <DataRow
                          icon={<Target size={18} />}
                          label="Zenith Angle"
                          value={`${result.zenith}°`}
                          sub="90° − alt"
                          accent="#64748b"
                          isLast
                        />
                      </div>
                    </div>
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <DataRow
                          icon={<Sunrise size={18} />}
                          label="Sunrise"
                          value={result.sunrise}
                          accent="#f59e0b"
                          isLast
                        />
                      </div>
                    </div>
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <DataRow
                          icon={<RefreshCw size={18} />}
                          label="Arc Angle"
                          value={`${result.arcAngle}°`}
                          sub="Motor 1"
                          accent="#8b5cf6"
                          isLast
                        />
                      </div>
                    </div>
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <DataRow
                          icon={<Settings size={18} />}
                          label="Carriage Angle"
                          value={`${result.carriageAngle}°`}
                          sub="Motor 2"
                          accent="#ec4899"
                          isLast
                        />
                      </div>
                    </div>
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <DataRow
                          icon={<Sunset size={18} />}
                          label="Sunset"
                          value={result.sunset}
                          accent="#ea580c"
                          isLast
                        />
                      </div>
                    </div>
                    <div className="col-12 col-md-6 col-xl-3">
                      <div className={tile}>
                        <div className="d-flex align-items-center justify-content-between py-2">
                          <div className="d-flex align-items-center gap-3">
                            <div style={{ color: "#64748b" }}>
                              <Settings size={18} />
                            </div>
                            <span
                              className="text-secondary fw-semibold"
                              style={{ fontSize: 13 }}
                            >
                              Motor Steps
                            </span>
                          </div>
                          <div
                            className="d-flex flex-column text-end"
                            style={{ fontSize: 13 }}
                          >
                            <div className="text-secondary">
                              Arc:{" "}
                              <strong className="text-dark">{arcSteps}</strong>
                            </div>
                            <div className="text-secondary">
                              Carriage:{" "}
                              <strong className="text-dark">{carSteps}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        <div className="text-center mt-5 pb-4">
          <div className="text-muted" style={{ fontSize: 12 }}>
            © {new Date().getFullYear()} AK Software Developers · All rights
            reserved
          </div>
        </div>
      </div>
    </div>
  );
}