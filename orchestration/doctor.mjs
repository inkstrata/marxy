// The fleet's health in one read. Kept as a name people know; the checks live in fleet.mjs (ADR-0034).
// usage: node orchestration/doctor.mjs
import { commands } from './fleet.mjs';

commands.doctor();
