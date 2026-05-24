import { useState, useEffect, useRef } from "react";
import SunCalc from "suncalc";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import logo from "../assets/logo2.png";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const TIMEAPI   = "https://timeapi.io/api/TimeZone/coordinate";

// ─── 3D Sun Scene with OrbitControls ─────────────────────────────────────────
function SunScene({ azimuth, elevation }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.018);

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 500);
    camera.position.set(8, 12, 18);
    camera.lookAt(0, 2, 0);

    // ── Orbit Controls for interactivity ──
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.target.set(0, 3, 0);

    // Sky sphere
    const skyGeo = new THREE.SphereGeometry(200, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor:    { value: new THREE.Color(0x020212) },
        bottomColor: { value: new THREE.Color(0x0d0d2b) },
      },
      vertexShader: `varying vec3 vWP; void main(){ vWP=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec3 topColor,bottomColor; varying vec3 vWP; void main(){ float h=normalize(vWP+30.).y; gl_FragColor=vec4(mix(bottomColor,topColor,max(pow(max(h,0.),.4),0.)),1.);}`,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshStandardMaterial({ color: 0x111128, roughness: 0.9, metalness: 0.1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Rings
    for (let r = 4; r <= 24; r += 4) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.05, r + 0.05, 64),
        new THREE.MeshBasicMaterial({ color: 0x1a1a3a, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
      scene.add(ring);
    }

    // Direction lines (N, S, E, W)
    [0, 90, 180, 270].forEach(deg => {
      const a = deg * Math.PI / 180;
      const pts = [new THREE.Vector3(0,0.02,0), new THREE.Vector3(Math.sin(a)*26, 0.02, -Math.cos(a)*26)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x223344 })));
    });

    const makeLabel = (text, x, z, color = "#446688") => {
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.font = "bold 36px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.position.set(x, 0.5, z);
      sprite.scale.set(1.5, 1.5, 1);
      scene.add(sprite);
    };
    makeLabel("N", 0, -20, "#4488aa"); makeLabel("S", 0, 20, "#4488aa");
    makeLabel("E", 20, 0, "#4488aa");  makeLabel("W", -20, 0, "#4488aa");

    // Observer
    const observer = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 1.5 })
    );
    observer.position.set(0, 0.28, 0);
    scene.add(observer);

    scene.add(new THREE.AmbientLight(0x111133, 1));

    const az  = azimuth  * Math.PI / 180;
    const el2 = elevation * Math.PI / 180;
    const R   = 18;
    const isAbove = elevation > -5;

    const sunX =  Math.sin(az) * Math.cos(el2) * R;
    const sunY =  Math.sin(el2) * R;
    const sunZ = -Math.cos(az) * Math.cos(el2) * R;

    const sunColor = elevation > 0
      ? (elevation < 15 ? 0xff6600 : elevation < 30 ? 0xffaa00 : 0xffdd44)
      : 0x334466;

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 32, 32),
      new THREE.MeshStandardMaterial({ color: sunColor, emissive: sunColor, emissiveIntensity: isAbove ? 2.5 : 0.3 })
    );
    sun.position.set(sunX, Math.max(sunY, -3), sunZ);
    scene.add(sun);

    if (isAbove) {
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(2.8, 16, 16),
        new THREE.MeshBasicMaterial({ color: sunColor, transparent: true, opacity: 0.1, depthWrite: false })
      );
      glow.position.copy(sun.position);
      scene.add(glow);
    }

    const sunLight = new THREE.DirectionalLight(isAbove ? sunColor : 0x112244, isAbove ? 2.5 : 0.2);
    sunLight.position.copy(sun.position);
    sunLight.castShadow = true;
    scene.add(sunLight);

    const zenith = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    zenith.position.set(0, R, 0);
    scene.add(zenith);

    // Ray from observer to sun
    const rayPts = [new THREE.Vector3(0, 0.28, 0), sun.position.clone()];
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(rayPts),
      new THREE.LineDashedMaterial({ color: isAbove ? 0xffdd44 : 0x334466, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.85 })
    );
    ray.computeLineDistances();
    scene.add(ray);

    // Zenith line
    const zPts = [new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0, R, 0)];
    const zLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(zPts),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.4 })
    );
    zLine.computeLineDistances();
    scene.add(zLine);

    // Zenith angle arc
    const zArcPts = [];
    const zArcR = 6;
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el2), Math.sin(el2), -Math.cos(az) * Math.cos(el2)).normalize();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const v = new THREE.Vector3(0, 1, 0).lerp(sunDir, t).normalize().multiplyScalar(zArcR);
      zArcPts.push(v);
    }
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(zArcPts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 })
    ));

    // Azimuth arc
    const arcPts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * az;
      arcPts.push(new THREE.Vector3(Math.sin(a) * 7, 0.02, -Math.cos(a) * 7));
    }
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(arcPts),
      new THREE.LineBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.85 })
    ));

    // Elevation arc
    const elArcPts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.max(el2, -0.3);
      elArcPts.push(new THREE.Vector3(
        Math.sin(az) * Math.cos(a) * 9,
        Math.sin(a) * 9,
        -Math.cos(az) * Math.cos(a) * 9,
      ));
    }
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(elArcPts),
      new THREE.LineBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0.85 })
    ));

    // Horizon ring
    const hPts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      hPts.push(new THREE.Vector3(Math.sin(a) * 18, 0.03, -Math.cos(a) * 18));
    }
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(hPts),
      new THREE.LineBasicMaterial({ color: 0x223355, transparent: true, opacity: 0.5 })
    ));

    // Stars
    const starVerts = [];
    for (let i = 0; i < 600; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 150 + Math.random() * 30;
      starVerts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, transparent: true, opacity: 0.5 })));

    let frame;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const W2 = el.clientWidth, H2 = el.clientHeight;
      camera.aspect = W2 / H2; camera.updateProjectionMatrix();
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
  }, [azimuth, elevation]);

  return (
    <div ref={mountRef} style={{
      width: "100%", height: 480, borderRadius: 12, overflow: "hidden",
      border: "1px solid rgba(255,200,50,0.15)", marginTop: 4,
    }} />
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
      {[
        { color: "#ffdd44", label: "Sun ray" },
        { color: "#44aaff", label: "Azimuth arc" },
        { color: "#ff6644", label: "Altitude arc" },
        { color: "#ffffff", label: "Zenith angle arc" },
        { color: "#4488ff", label: "Observer" },
      ].map(({ color, label }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
          <span style={{ color: "#777", fontSize: 10 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function ViewControls({ onResetView }) {
  return (
    <div style={{
      position: "relative",
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: 8,
      gap: 8,
    }}>
      <button
        onClick={onResetView}
        style={{
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,200,50,0.4)",
          borderRadius: 20,
          padding: "6px 14px",
          color: "#ffd700",
          fontSize: 11,
          cursor: "pointer",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          transition: "all 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,200,50,0.2)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.6)"; }}
      >
        <span>🎥</span> Reset Camera
      </button>
      <div style={{
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,200,50,0.3)",
        borderRadius: 20,
        padding: "4px 12px",
        color: "#aaa",
        fontSize: 10,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <span>🖱️ Drag to rotate</span>
        <span>🔽 Right-click to pan</span>
        <span>📌 Scroll to zoom</span>
      </div>
    </div>
  );
}

const Tile = ({ icon, label, value, sub, accent = "#ffd700" }) => (
  <div style={{
    background: "rgba(255,215,0,0.06)", border: `1px solid ${accent}33`,
    borderRadius: 10, padding: "12px 10px", textAlign: "center",
  }}>
    <div style={{ fontSize: 20 }}>{icon}</div>
    <div style={{ color: "#777", fontSize: 9, letterSpacing: 1, margin: "4px 0 2px", textTransform: "uppercase" }}>{label}</div>
    <div style={{ color: accent, fontSize: 18, fontWeight: "bold" }}>{value}</div>
    {sub && <div style={{ color: "#999", fontSize: 10, marginTop: 2 }}>{sub}</div>}
  </div>
);

export default function SunCalculator() {
  const [place, setPlace]     = useState("");
  const [date, setDate]       = useState("");
  const [time, setTime]       = useState("");
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [resetViewTrigger, setResetViewTrigger] = useState(0);

  const getLatLng = async (placeName) => {
    const res  = await fetch(`${NOMINATIM}?format=json&q=${encodeURIComponent(placeName)}&limit=1`);
    const data = await res.json();
    if (!data.length) throw new Error("Place not found. Try a more specific name.");
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), displayName: data[0].display_name };
  };

  const getTimezone = async (lat, lon) => {
    try {
      const res  = await fetch(`${TIMEAPI}?latitude=${lat}&longitude=${lon}`);
      const data = await res.json();
      return data.timeZone;
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  };

  const localToUTC = (dateStr, timeStr, tz) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const [hour, minute]     = timeStr.split(":").map(Number);
    const roughUTC = Date.UTC(year, month - 1, day, hour, minute);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(roughUTC).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const tzMs  = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    return new Date(roughUTC + (roughUTC - tzMs));
  };

  const toDeg = (rad) => rad * (180 / Math.PI);

  const calculate = async () => {
    setError("");
    if (!place || !date || !time) { setError("Please fill in all fields."); return; }
    setLoading(true);
    try {
      const { lat, lon, displayName } = await getLatLng(place);
      const tz  = await getTimezone(lat, lon);
      const utc = localToUTC(date, time, tz);
      const pos = SunCalc.getPosition(utc, lat, lon);

      const altitude = toDeg(pos.altitude);
      const azimuth  = (toDeg(pos.azimuth) + 180) % 360;
      const zenith   = 90 - altitude;

      const times = SunCalc.getTimes(utc, lat, lon);
      const fmtTime = (d) => {
        if (!isFinite(d)) return "N/A";
        return new Intl.DateTimeFormat("en-IN", {
          timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true,
        }).format(d);
      };

      setResult({
        place: displayName.split(",").slice(0, 2).join(", "),
        lat: lat.toFixed(5), lon: lon.toFixed(5), tz,
        altitude: altitude.toFixed(3),
        zenith:   zenith.toFixed(3),
        azimuth:  azimuth.toFixed(3),
        sunrise:  fmtTime(times.sunrise),
        sunset:   fmtTime(times.sunset),
        isAboveHorizon: altitude > 0,
        utcISO: utc.toISOString(),
      });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const compassDir = (az) => {
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(az / 22.5) % 16];
  };

  const handleResetView = () => {
    setResetViewTrigger(prev => prev + 1);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
      fontFamily: "'Courier New', monospace",
    }}>

      {/* ── Top Navbar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 28px",
        background: "rgba(0,0,0,0.35)",
        borderBottom: "1px solid rgba(255,200,50,0.15)",
        backdropFilter: "blur(8px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src={logo}
            alt="AK Software Developers logo"
            style={{
              height: 42, width: 42,
              borderRadius: 8,
              border: "1px solid rgba(255,200,50,0.3)",
              objectFit: "contain",
              background: "rgba(255,255,255,0.05)",
              padding: 2,
            }}
          />
          <div>
            <div style={{ color: "#ffd700", fontSize: 13, fontWeight: "bold", letterSpacing: 1 }}>
              AK Software Developers
            </div>
            <div style={{ color: "#888", fontSize: 9, letterSpacing: 1, marginTop: 1 }}>
              Sun Emulation Project
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="https://aksoftwareco.in/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              color: "#88ccff", fontSize: 10, letterSpacing: 0.5,
              textDecoration: "none",
              background: "rgba(68,136,255,0.08)",
              border: "1px solid rgba(68,136,255,0.25)",
              borderRadius: 20, padding: "6px 14px",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color="#aaddff"; e.currentTarget.style.borderColor="rgba(68,136,255,0.55)"; e.currentTarget.style.background="rgba(68,136,255,0.15)"; }}
            onMouseLeave={e => { e.currentTarget.style.color="#88ccff"; e.currentTarget.style.borderColor="rgba(68,136,255,0.25)"; e.currentTarget.style.background="rgba(68,136,255,0.08)"; }}
          >
            <span style={{ color: "#aaa", fontSize: 8, letterSpacing: 1 }}>VISIT OUR WEBSITE</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 11 }}>🌐</span>
              <span>aksoftwareco.in</span>
            </div>
          </a>

          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            background: "rgba(255,180,0,0.1)",
            border: "1px solid rgba(255,180,0,0.35)",
            borderRadius: 20, padding: "5px 14px",
          }}>
            <span style={{
              display: "inline-block", width: 7, height: 7, borderRadius: "50%",
              background: "#ffaa00",
              animation: "blink 1.2s ease-in-out infinite",
            }} />
            <span style={{ color: "#ffcc44", fontSize: 10, letterSpacing: 1 }}>
              UNDER CONSTRUCTION
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.15; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "28px 20px" }}>
        <div style={{ width: "100%", maxWidth: 540 }}>

          <div style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,200,50,0.3)",
            borderRadius: 16, padding: "32px",
            boxShadow: "0 0 60px rgba(255,180,0,0.1)",
          }}>

            {/* ── Header with watermark ── */}
            <div style={{ textAlign: "center", marginBottom: 28, position: "relative" }}>

              {/* Watermark layer — sits behind content, cannot be interacted with */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%) rotate(-15deg)",
                  fontSize: 15,
                  fontWeight: "bold",
                  color: "rgba(255, 215, 0, 0.10)",
                  letterSpacing: 5,
                  whiteSpace: "nowrap",
                  userSelect: "none",
                  pointerEvents: "none",
                  zIndex: 0,
                  fontFamily: "'Courier New', monospace",
                  textTransform: "uppercase",
                  lineHeight: 1,
                  width: "max-content",
                  maxWidth: "none",
                }}
              >
                AK Software Developers
              </div>

              {/* Actual header content — above watermark */}
              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{ fontSize: 48, marginBottom: 4 }}>☀️</div>
                <h2 style={{ color: "#ffd700", margin: 0, fontSize: 22, letterSpacing: 2 }}>SUN POSITION</h2>
                <p style={{ color: "#aaa", margin: "4px 0 0", fontSize: 12 }}>Azimuth · Altitude · Zenith Angle</p>
              </div>
            </div>

            {[
              { label: "📍 Place", type: "text", value: place, onChange: setPlace, placeholder: "e.g. Dharwad, Karnataka" },
              { label: "📅 Date",  type: "date", value: date,  onChange: setDate },
              { label: "🕐 Time",  type: "time", value: time,  onChange: setTime },
            ].map(({ label, type, value, onChange, placeholder }) => (
              <div key={label} style={{ marginBottom: 16 }}>
                <label style={{ color: "#ffd700", fontSize: 11, letterSpacing: 1, display: "block", marginBottom: 6 }}>{label}</label>
                <input
                  type={type} value={value} placeholder={placeholder || ""}
                  onChange={(e) => onChange(e.target.value)}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,200,50,0.25)",
                    borderRadius: 8, padding: "10px 14px",
                    color: "#fff", fontSize: 14, outline: "none", colorScheme: "dark",
                  }}
                />
              </div>
            ))}

            {error && (
              <div style={{
                background: "rgba(255,60,60,0.15)", border: "1px solid rgba(255,60,60,0.4)",
                borderRadius: 8, padding: "10px 14px", color: "#ff8080", fontSize: 13, marginBottom: 16,
              }}>⚠️ {error}</div>
            )}

            <button
              onClick={calculate} disabled={loading}
              style={{
                width: "100%", padding: "12px",
                background: loading ? "#555" : "linear-gradient(135deg, #f7971e, #ffd200)",
                border: "none", borderRadius: 8,
                color: "#1a1a1a", fontWeight: "bold", fontSize: 15,
                cursor: loading ? "not-allowed" : "pointer", letterSpacing: 1,
              }}
            >
              {loading ? "⏳ Calculating..." : "CALCULATE SUN POSITION"}
            </button>

            {result && (
              <div style={{ marginTop: 28, borderTop: "1px solid rgba(255,200,50,0.2)", paddingTop: 20 }}>
                <p style={{ color: "#ffd700", fontSize: 11, letterSpacing: 2, margin: "0 0 6px" }}>📍 {result.place}</p>
                <p style={{ color: "#777", fontSize: 11, margin: "0 0 4px" }}>{result.lat}°N, {result.lon}°E &nbsp;|&nbsp; {result.tz}</p>
                <p style={{ color: "#444", fontSize: 10, margin: "0 0 18px" }}>UTC: {result.utcISO}</p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <Tile icon="🧭" label="Azimuth"      value={`${result.azimuth}°`}  sub={compassDir(parseFloat(result.azimuth))} accent="#44aaff" />
                  <Tile icon="📐" label="Altitude"     value={`${result.altitude}°`} sub={result.isAboveHorizon ? "Above horizon" : "Below horizon"} accent="#ff9944" />
                  <Tile icon="🎯" label="Zenith Angle" value={`${result.zenith}°`}   sub="90° − altitude" accent="#ffffff" />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Tile icon="🌅" label="Sunrise" value={result.sunrise} accent="#ff9944" />
                  <Tile icon="🌇" label="Sunset"  value={result.sunset}  accent="#ff6644" />
                </div>

                <p style={{ color: result.isAboveHorizon ? "#7dff7d" : "#ff7d7d", textAlign: "center", fontSize: 12, marginTop: 14, marginBottom: 0 }}>
                  {result.isAboveHorizon ? "✅ Sun is above the horizon" : "🌙 Sun is below the horizon"}
                </p>
              </div>
            )}
          </div>

          {result && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,200,50,0.15)" }} />
                <span style={{ color: "#ffd700", fontSize: 11, letterSpacing: 2 }}>3D CELESTIAL VIEW</span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,200,50,0.15)" }} />
              </div>
              <ViewControls onResetView={handleResetView} />
              <SunScene
                key={resetViewTrigger}
                azimuth={parseFloat(result.azimuth)}
                elevation={parseFloat(result.altitude)}
              />
              <Legend />

              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12,
                background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "12px",
                border: "1px solid rgba(255,255,255,0.06)",
              }}>
                {[
                  { label: "Azimuth",      value: `${result.azimuth}°`,  color: "#44aaff", desc: "N → clockwise" },
                  { label: "Altitude",     value: `${result.altitude}°`, color: "#ff9944", desc: "from horizon" },
                  { label: "Zenith Angle", value: `${result.zenith}°`,   color: "#ffffff", desc: "from zenith" },
                ].map(({ label, value, color, desc }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ color, fontSize: 15, fontWeight: "bold" }}>{value}</div>
                    <div style={{ color: "#aaa", fontSize: 9, letterSpacing: 0.5 }}>{label}</div>
                    <div style={{ color: "#555", fontSize: 9 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 32, paddingBottom: 20 }}>
            <div style={{ color: "#333", fontSize: 9, letterSpacing: 1 }}>
              © {new Date().getFullYear()} AK Software Developers · All rights reserved
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}