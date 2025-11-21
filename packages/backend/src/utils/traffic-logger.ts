import type { TrafficLogEntry, TrafficLogger } from '../services/traffic/traffic-logger'
import { trafficLogger as defaultTrafficLogger } from '../services/traffic/traffic-logger'

let currentTrafficLogger: TrafficLogger = defaultTrafficLogger

export const setTrafficLogger = (logger: TrafficLogger) => {
  currentTrafficLogger = logger
}

export const getTrafficLogger = () => currentTrafficLogger

export const logTraffic = async (entry: TrafficLogEntry) => currentTrafficLogger.log(entry)
