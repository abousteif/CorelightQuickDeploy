variable "subscription_id" {
  type        = string
  description = "Azure subscription ID to deploy into (from the operator's `az login`)."
}

variable "location" {
  type        = string
  description = "Azure region."
  default     = "centralus"
}

variable "name_prefix" {
  type        = string
  description = "Short unique prefix for all resource names in this deployment (e.g. cqd-a1b2c3)."
}

variable "admin_username" {
  type        = string
  description = "Linux admin user created on every VM."
  default     = "azureuser"
}

variable "ssh_public_key" {
  type        = string
  description = "OpenSSH public key material authorized on every VM (the deployer generates a per-run keypair)."
}

variable "admin_source_cidrs" {
  type        = list(string)
  description = "Source CIDRs allowed inbound to SSH (22) and the Fleet UI (443). Defaults to the operator's detected public IP."
  default     = []
}

variable "vnet_cidr" {
  type        = string
  description = "Address space for the new VNet."
  default     = "10.50.0.0/16"
}

variable "subnet_cidr" {
  type        = string
  description = "Address prefix for the single subnet that holds Fleet + sensors."
  default     = "10.50.0.0/24"
}

variable "fleet_vm_size" {
  type        = string
  description = "VM size for the Fleet Manager VM."
  default     = "Standard_D4s_v3"
}

variable "sensor_vm_size" {
  type        = string
  description = "VM size for each sensor VM."
  default     = "Standard_D4s_v3"
}

variable "os_disk_size_gb" {
  type        = number
  description = "OS disk size in GB for every VM (sensor images + Fleet need headroom)."
  default     = 128
}

variable "deploy_fleet" {
  type        = bool
  description = "Whether to create a Fleet Manager VM. If false, the operator supplies an existing Fleet out-of-band."
  default     = true
}

variable "sensor_count" {
  type        = number
  description = "Number of Software Sensor VMs to create."
  default     = 1
}

variable "fleet_dns_label" {
  type        = string
  description = "Globally-unique DNS label for the Fleet public IP (<label>.<region>.cloudapp.azure.com). Ignored when deploy_fleet=false."
  default     = ""
}

variable "image_publisher" {
  type    = string
  default = "almalinux"
}

variable "image_offer" {
  type    = string
  default = "almalinux-x86_64"
}

variable "image_sku" {
  type    = string
  default = "9-gen2"
}

variable "image_version" {
  type    = string
  default = "latest"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to every resource."
  default = {
    managed-by = "corelight-quick-deploy"
  }
}
