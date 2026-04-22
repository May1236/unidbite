// Script to fetch current Overpass data and save as static JSON
// Run this in browser console or as a Node.js script to generate overpass-response.json

async function saveOverpassData() {
  const SAIT = { lat: 51.0640, lon: -114.0910 };
  const radiusMeters = 1000;
  const endpoint = "https://overpass-api.de/api/interpreter";

  const AMENITY_FAST_FOOD = "fast_food";
  const query = `
  [out:json][timeout:25];
  (
    node["amenity"~"restaurant|cafe|${AMENITY_FAST_FOOD}"](around:${radiusMeters},${SAIT.lat},${SAIT.lon});
    way["amenity"~"restaurant|cafe|${AMENITY_FAST_FOOD}"](around:${radiusMeters},${SAIT.lat},${SAIT.lon});
    relation["amenity"~"restaurant|cafe|${AMENITY_FAST_FOOD}"](around:${radiusMeters},${SAIT.lat},${SAIT.lon});
  );
  out center tags;
  `;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: query
    });

    if (!res.ok) throw new Error(`Overpass failed: ${res.status}`);

    const data = await res.json();

    // Save to file (in browser, this would download)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "overpass-response.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    console.log("Overpass data saved to overpass-response.json");
  } catch (err) {
    console.error("Failed to fetch Overpass data:", err);
  }
}

// Uncomment to run: saveOverpassData();