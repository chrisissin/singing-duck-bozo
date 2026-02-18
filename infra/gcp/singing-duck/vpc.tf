# Private IP for Cloud SQL and VPC connector for Cloud Run
# depends_on ensures Compute API is enabled before reading the default network
data "google_compute_network" "default" {
  name       = "default"
  depends_on = [google_project_service.compute]
}

# Service networking connection already exists with allocated range [default-ip-range].
# Import it first, then use the existing range (do not create a new connection):
#
#   terraform import google_service_networking_connection.private_vpc_connection \
#     projects/singing-duck-boso/global/networks/default:servicenetworking.googleapis.com
#
resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = ["default-ip-range"]
}

# Serverless VPC Access connector so Cloud Run can reach Cloud SQL private IP
resource "google_vpc_access_connector" "connector" {
  name          = "slack-rag-connector"
  region        = var.region
  network       = data.google_compute_network.default.name
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 3
  depends_on    = [google_project_service.vpcaccess]
}
