// Dropdown option lists. Each starts with a SINGLE option by design (per product decision);
// adding more later = append entries here. `mlWarn` flags sizes that can't run ML/Anomaly.
export const REGIONS = [
  { value: "centralus", label: "Central US" },
  // more regions added here later
];

export const VM_SIZES = [
  { value: "Standard_D4s_v3", label: "Standard_D4s_v3 (4 vCPU / 16 GiB)", mlWarn: true },
  { value: "Standard_D8s_v7", label: "Standard_D8s_v7 (8 vCPU / 32 GiB)", mlWarn: false },
  { value: "Standard_D16s_v7", label: "Standard_D16s_v7 (16 vCPU / 64 GiB)", mlWarn: false },
];

export const DEFAULTS = {
  region: "centralus",
  fleetVmSize: "Standard_D8s_v7",
  sensorVmSize: "Standard_D4s_v3",
  sensorCount: 1,
  deployFleet: true,
  communityString: "corelight",
  vnetCidr: "10.50.0.0/16",
};
