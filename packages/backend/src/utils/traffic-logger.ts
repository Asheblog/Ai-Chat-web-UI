import type { TrafficLogEntry } from '../services/traffic/traffic-logger'
import { trafficLogger } from '../services/traffic/traffic-logger'

export const logTraffic = async (entry: TrafficLogEntry) => trafficLogger.log(entry)
