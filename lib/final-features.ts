import type { PeakKey, TrafficRecord } from "./traffic";

export type VehicleScheme = {
  id: string;
  name: string;
  mappings: Record<string, string>;
  createdAt: string;
};

export type RecordRevision = {
  id: string;
  recordId: string;
  savedAt: string;
  reason: string;
  snapshot: TrafficRecord;
};

export function recordPeakTotal(record: TrafficRecord, peak: PeakKey) {
  return Math.round(
    record.approaches.reduce(function (sum, approach) {
      const movement = approach.movements[peak];
      return sum + movement.left + movement.through + movement.right;
    }, 0) * 10,
  ) / 10;
}

export function routePeakTotal(record: TrafficRecord, peak: PeakKey) {
  if (!record.routes?.length) return recordPeakTotal(record, peak);
  return Math.round(
    record.routes.reduce(function (sum, route) {
      return sum + Number(route.volumes[peak]?.pcu || 0);
    }, 0) * 10,
  ) / 10;
}

export function conservationCheck(record: TrafficRecord, peak: PeakKey) {
  const movement = recordPeakTotal(record, peak);
  const routes = routePeakTotal(record, peak);
  const difference = Math.round((movement - routes) * 10) / 10;
  return { movement, routes, difference, valid: Math.abs(difference) < 0.11 };
}

export function odMatrix(record: TrafficRecord, peak: PeakKey) {
  return record.approaches.map(function (origin) {
    return {
      originId: origin.id,
      origin: origin.name,
      values: record.approaches.map(function (destination) {
        if (origin.id === destination.id) return 0;
        return Math.round(
          (record.routes || [])
            .filter(function (route) {
              return route.fromApproachId === origin.id && route.toApproachId === destination.id;
            })
            .reduce(function (sum, route) {
              return sum + Number(route.volumes[peak]?.pcu || 0);
            }, 0) * 10,
        ) / 10;
      }),
    };
  });
}

export function branchBalance(record: TrafficRecord, peak: PeakKey) {
  return record.approaches.map(function (approach) {
    const outbound = (record.routes || []).filter(function (route) {
      return route.fromApproachId === approach.id;
    }).reduce(function (sum, route) {
      return sum + Number(route.volumes[peak]?.pcu || 0);
    }, 0);
    const inbound = (record.routes || []).filter(function (route) {
      return route.toApproachId === approach.id;
    }).reduce(function (sum, route) {
      return sum + Number(route.volumes[peak]?.pcu || 0);
    }, 0);
    const fallback = approach.movements[peak];
    const source = record.routes?.length ? outbound : fallback.left + fallback.through + fallback.right;
    return {
      id: approach.id,
      name: approach.name,
      inbound: Math.round(inbound * 10) / 10,
      outbound: Math.round(source * 10) / 10,
      difference: Math.round((inbound - source) * 10) / 10,
    };
  });
}

export function peakSensitivity(record: TrafficRecord) {
  const intervals = record.sourceTrace?.intervals || [];
  const windows = intervals.map(function (item) {
    const selected = intervals.filter(function (candidate) {
      return candidate.start >= item.start && candidate.start < item.start + 60;
    });
    const continuous = selected.length > 0 && selected[selected.length - 1].end === item.start + 60;
    return {
      start: item.start,
      end: item.start + 60,
      pcu: Math.round(selected.reduce(function (sum, candidate) { return sum + candidate.pcu; }, 0) * 10) / 10,
      vehicles: selected.reduce(function (sum, candidate) { return sum + candidate.vehicles; }, 0),
      continuous,
    };
  }).filter(function (item) { return item.continuous; });
  return windows
    .sort(function (a, b) { return b.pcu - a.pcu || a.start - b.start; })
    .slice(0, 8)
    .map(function (item, index) {
      return { ...item, rank: index + 1 };
    });
}

export function quarterQualitySummary(records: TrafficRecord[]) {
  return records.map(function (record) {
    const am = conservationCheck(record, "AM");
    const pm = conservationCheck(record, "PM");
    const unmapped = (record.routes || []).filter(function (route) {
      return !record.approaches.some(function (approach) { return approach.id === route.toApproachId; });
    }).length;
    return {
      record,
      am,
      pm,
      unmapped,
      valid: am.valid && pm.valid && unmapped === 0 && Boolean(record.date),
    };
  });
}

export function diagramCollisionWarnings(record: TrafficRecord) {
  const warnings: string[] = [];
  const points = record.approaches.map(function (approach) {
    const rad = (approach.angle * Math.PI) / 180;
    const offset = approach.cardOffset || { x: 0, y: 0 };
    return {
      name: approach.name,
      x: Math.cos(rad) * 390 + offset.x,
      y: Math.sin(rad) * 390 + offset.y,
    };
  });
  for (let left = 0; left < points.length; left++) {
    for (let right = left + 1; right < points.length; right++) {
      if (Math.abs(points[left].x - points[right].x) < 230 && Math.abs(points[left].y - points[right].y) < 125)
        warnings.push(points[left].name + " 與 " + points[right].name + " 的數據框可能重疊");
    }
  }
  return warnings;
}
