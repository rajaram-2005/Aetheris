# Robotics & Digital Twins

## ROS 2 via rosbridge

Aetheris talks to ROS 2 through **rosbridge_suite's WebSocket JSON protocol** — no native ROS SDK inside the Next.js server, so it works from any host that can reach `ws://robot:9090`. Source: `src/core/robotics/rosbridge.ts`; API: `/api/robots`.

```
 Aetheris ──ws JSON──▶ rosbridge_websocket ──▶ ROS 2 graph (real robot · Gazebo · Webots · TurtleBot sim)
     ▲                         │
     └── /odom, topics ◀───────┘
```

Start rosbridge on the robot/sim machine:

```bash
sudo apt install ros-$ROS_DISTRO-rosbridge-suite
ros2 launch rosbridge_server rosbridge_websocket_launch.xml   # :9090
```

| Operation | Endpoint | Permission |
|---|---|---|
| Inspect topics / services / nodes | `GET /api/robots?url=ws://robot:9090` | read_only |
| Read one message | `POST {op:"echo", url, topic, type?}` | read_only |
| Dry-run the governor | `POST {op:"govern", linear, angular, safety?, pose?}` | none (pure) |
| Governed motion for N ms | `POST {op:"move", url, linear, angular, durationMs?, safety?, confirmationToken}` | **physical** grant + confirmation |
| E-stop | `POST {op:"estop", url}` | physical grant, **no confirmation** |

### Safety governor (`RobotSafety`, tested)

```ts
{ maxLinear: 0.3, maxAngular: 0.8, watchdogMs: 1500, cmdVelTopic: "/cmd_vel", odomTopic: "/odom", geofence?: {xMin,xMax,yMin,yMax} }
```

* **Clamp** every Twist to `maxLinear/maxAngular`.
* **Geofence**: if the pose (from `/odom`) is outside the box and the command moves outward, the command is zeroed.
* **Watchdog**: if no heartbeat within `watchdogMs`, a zero Twist is published — the robot cannot run away on a dropped connection.
* **E-stop** publishes zero Twist, latches, and closes the session.
* Every command is an `robot` event in the audit trail.

**Status: IMPLEMENTED against the rosbridge protocol and verified with an in-repo mock rosbridge server; UNVERIFIED against a real ROS 2 graph from this sandbox.** Nothing about the robot is simulated inside Aetheris — inspect/echo/move open a live connection or fail.

Not available: ROS 1, DDS-direct, MoveIt planning, Nav2 goal management (send Nav2 goals through a rosbridge *service call*/action topic yourself if needed).

## Digital twins

A twin is a persisted, typed model of an asset that agents reason over **before** acting. Source: `src/core/twins/twins.ts`; API: `/api/twins`, `/api/twins/:id`.

```
 devices ──telemetry──▶ twin.state + history ──▶ health (staleness · bounds · maintenance)
                                            └──▶ simulate(proposed actuation, N steps) ──▶ breaches?
```

```jsonc
POST /api/twins
{ "name": "boiler-1", "kind": "boiler", "deviceIds": ["<device id>"],
  "state": { "temp": 60, "valve": 0 },
  "bounds": [{ "key": "temp", "max": 90, "unit": "°C", "critical": true }],
  "rules":  [{ "target": "temp", "expr": "temp + 0.4*valve*dt/60 - 0.05*(temp-20)" }],
  "stepSeconds": 60 }
```

* `{op:"sync"}` pulls the latest telemetry from linked devices into `state` and `history` (the scheduler also syncs all twins every tick).
* `{op:"simulate", proposed:{valve:100}, steps:30}` applies the rules forward with a **safe arithmetic DSL (no `eval`)** and reports the first step at which a bound is breached.
* `health` = 0–100 from staleness, out-of-bounds values and overdue maintenance; `critical` bounds weigh more.
* Automations can trigger on `twin` health/bound events and automations' `verify` stage can require a twin expression to hold before acting.

**Status: IMPLEMENTED** (rule-based first-order models; no CAD/FEA/physics engines). Every number it shows is computed from stored data.

## Recommended loop for an industrial cell

1. Register devices (`docs/HARDWARE.md`), give each actuator limits and interlocks.
2. Create a twin over them with bounds and rules; let it sync for a while.
3. Automations: `device` trigger → condition → optional agent → **verify against the twin** → action (with a stored physical confirmation).
4. Watch Control Center → devices/twins/automations; export audit from `/api/telemetry/audit`.
