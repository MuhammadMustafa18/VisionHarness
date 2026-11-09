# Computer Vision Scene Topologies & Counting Semantics Playbook

This reference matrix defines how VisionHarness interprets real-world camera scenes, maps user intent to computer vision primitives, and decides when to ask clarifying questions before building an inference pipeline.

---

## 1. Scene Topologies & Primitives Decision Matrix

| Scene Topology | Visual Indicators | Typical Objectives | Recommended CV Metric | Geometry Primitive | Tracking Logic |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Open Urban Street / Walkway / Plaza** | Wide angle, high-angle CCTV, wet road, sidewalks, no physical turnstiles or doorways. | Footfall volume, crowd density, corridor transit. | **Total Unique Entity Tally** or **Directional Transit** | Polygon Zone or Single Directional Line | Count unique ByteTrack IDs in walkway zone. Do NOT assume retail doorway in/out. |
| **Storefront Entrance / Turnstile / Gate** | Narrow choke point, door frames, turnstile barriers, clear indoor/outdoor divide. | Store occupancy, visitor arrivals vs departures. | **Bidirectional Line Crossing** | Crossing Line | `trigger_in` (entering) + `trigger_out` (exiting). |
| **Bus Stop / Vendor Stall / Queue** | Waiting benches, food stalls, people lingering or standing stationary. | Wait time, service time, loitering. | **Dwell Time & Peak Occupancy** | Polygon Zone | Measure time entity ID stays inside polygon (e.g. > 15s). |
| **Restricted Perimeter / Industrial Yard** | Fences, construction barriers, dangerous equipment, vehicle bays. | Intrusion detection, safety violation. | **Zone Intrusion Alert** | Polygon Zone | Instant alert on bounding box entry or anchor point crossing. |
| **Highway / Roadway Intersection** | Traffic lanes, vehicles, crosswalks. | Vehicle counts per lane, speed estimation, turn counts. | **Lane Multi-Line Crossing** | Multiple Crossing Lines | Lane-specific unidirectional triggers. |

---

## 2. Clarification Rules (Chat Before Execution)

When the user gives a general or ambiguous instruction like *"count people"* or *"track this"*, the agent must check the scene context:

### Rule A: Open Space Ambiguity
- **Condition**: Scene is an open street/sidewalk, and user asks to "count people" with a crossing line.
- **Action**: Do **not** silently default to bidirectional in/out unless requested.
- **Clarification Prompt**:
  > *"Since this is an open walkway, do you want to count total unique pedestrians who pass this line, or track directional flow (arrivals vs departures)?"*

### Rule B: Density vs Volume
- **Condition**: User asks *"how busy is it"* or *"monitor crowd"*.
- **Action**: Ask whether they need **Peak Simultaneous Occupancy** (crowd density at any given second) or **Cumulative Footfall** (total volume over time).

### Rule C: Loitering vs Passing Through
- **Condition**: Footage shows vendor stalls, bus stops, or storefronts where people stop.
- **Action**: Propose whether stationary dwell time should be filtered out from passing foot traffic.
