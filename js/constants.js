const MU_SUN = 2.9591220828559115e-4;
const AUDAY_KMS = 1731.456;
const DAYS_PER_YEAR = 365.25;
const AU_KM = 149597870.7;

const PLANET_DEFS = [
  { name: "수성", a: 0.38709893, massRatio: 1.6601e-7, radiusKm: 2439.7, color: "#b3a08e", angleDeg: 40 },
  { name: "금성", a: 0.72333199, massRatio: 2.4478e-6, radiusKm: 6051.8, color: "#e8bf6b", angleDeg: 130 },
  { name: "지구", a: 1.00000011, massRatio: 3.0035e-6, radiusKm: 6371.0, color: "#63a7e6", angleDeg: 250 },
  { name: "화성", a: 1.52366231, massRatio: 3.2272e-7, radiusKm: 3389.5, color: "#e07a52", angleDeg: 315 },
  { name: "목성", a: 5.20336301, massRatio: 9.5458e-4, radiusKm: 69911, color: "#d9b07f", angleDeg: 160 },
  { name: "토성", a: 9.53707032, massRatio: 2.858e-4, radiusKm: 60268, color: "#e3cf9a", angleDeg: 75 },
  { name: "천왕성", a: 19.19126393, massRatio: 4.3663e-5, radiusKm: 25559, color: "#a3dbe8", angleDeg: 210 },
  { name: "해왕성", a: 30.06896348, massRatio: 5.151e-5, radiusKm: 24764, color: "#6b8cff", angleDeg: 325 },
];

function circVel(a) {
  return Math.sqrt(MU_SUN / a);
}

function soiRadius(a, massRatio) {
  return a * Math.pow(massRatio, 0.4);
}

function fmtSpeed(auDay) {
  return (auDay * AUDAY_KMS).toFixed(2) + " km/s";
}

function fmtDist(rAU) {
  if (rAU < 0.02) {
    return Math.round(rAU * AU_KM).toLocaleString("ko-KR") + " km";
  }
  return rAU.toFixed(3) + " AU";
}

function fmtTime(days) {
  if (days < DAYS_PER_YEAR) {
    return days.toFixed(1) + " 일";
  }
  const y = Math.floor(days / DAYS_PER_YEAR);
  const d = days - y * DAYS_PER_YEAR;
  return y + "년 " + d.toFixed(0) + "일";
}
