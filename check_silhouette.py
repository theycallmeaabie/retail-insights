# Standalone script to check silhouette score for KMeans clustering
# Not part of the main project — safe to delete

from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from backend.preprocessing import clean_dataframe as load_and_clean_data
from backend.rfm import compute_rfm

import pandas as pd
from pathlib import Path

DATA_FILE = Path("data/Online Retail.xlsx")

# Load and prepare data
if not DATA_FILE.exists():
    print(f"Data file not found at {DATA_FILE}")
    exit()

df_raw = pd.read_excel(DATA_FILE)
df = load_and_clean_data(df_raw)
rfm = compute_rfm(df)

# Scale RFM values
scaler = StandardScaler()
rfm_scaled = scaler.fit_transform(rfm[["Recency", "Frequency", "Monetary"]])

# Test different cluster counts
print("Silhouette Scores:")
print("-" * 30)
for k in range(2, 8):
    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(rfm_scaled)
    score = silhouette_score(rfm_scaled, labels)
    print(f"  k={k}  →  {score:.4f}")
