# 📊 Retail Insights Dashboard

A powerful, full-stack data analytics platform that transforms raw retail transactional data into actionable business intelligence. This application automates **RFM Analysis**, **Customer Segmentation**, and **Product Recommendations**, providing a sleek dashboard for real-time monitoring and a Jupyter Notebook for deep-dive statistical research.

---

## 🚀 Features

### 💻 Live Dashboard
- **Real-time Stats**: Track total revenue, customer count, and transaction volume instantly.
- **Monthly Trends**: Visualize revenue growth over time with interactive line charts.
- **Top Performers**: Identify your most valuable customers and best-selling products.
- **Dynamic Upload**: Drag-and-drop new Excel/CSV datasets to refresh the entire analytics engine without downtime.

### 🧠 Intelligence Engine
- **RFM Analysis**: Automatically calculates **Recency, Frequency, and Monetary** metrics for every customer.
- **Customer Segmentation**: Uses **K-Means Clustering** to categorize customers (e.g., VIP, Loyal, At-Risk, New).
- **Product Recommender**: An item-based collaborative filtering system using **Cosine Similarity** to suggest "frequently bought together" items.

### 📈 In-Depth Analysis (New)
- **Interactive Notebook**: A comprehensive Jupyter Notebook (`Retail_Insights_Analysis.ipynb`) for data scientists.
- **Elbow Method**: Mathematical verification for the optimal number of clusters.
- **Silhouette Analysis**: Visual validation of cluster density and separation.
- **3D Visualization**: Interactive 3D scatter plots of customer segments.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Vanilla HTML5, CSS3 (Modern UI), JavaScript (ES6+), Chart.js |
| **Backend** | FastAPI (Python), Uvicorn |
| **Data Science** | Pandas, Scikit-Learn, NumPy |
| **Visualization** | Matplotlib, Seaborn |
| **Storage** | Local Excel/CSV processing |

---

## 📂 Project Structure

```bash
├── backend/
│   ├── main.py             # FastAPI server & API endpoints
│   ├── preprocessing.py    # Data cleaning & validation logic
│   ├── rfm.py              # RFM metric computation
│   ├── clustering.py       # K-Means segmentation logic
│   └── recommender.py      # Cosine similarity engine
├── frontend/
│   ├── index.html          # SPA Architecture
│   ├── style.css           # Premium Dark/Light mode styles
│   └── app.js              # State management & Chart.js logic
├── data/
│   └── Online Retail.xlsx  # Default sample dataset
├── Retail_Insights_Analysis.ipynb  # 📓 Deep-dive research notebook
├── check_silhouette.py     # Standalone validation script
├── requirements.txt        # Project dependencies
└── diagrams/               # System architecture & flowcharts
```

---

## ⚙️ Quick Start

### 1. Environment Setup
```bash
# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt
```

### 2. Launch the Application
```bash
# Start the FastAPI server (from the root directory)
python -m uvicorn backend.main:app --reload
```
Open [http://localhost:8000](http://localhost:8000) in your browser.

### 3. Run Statistical Analysis
To explore the mathematical models behind the dashboard:
```bash
# Launch Jupyter
jupyter notebook Retail_Insights_Analysis.ipynb
```

---

## 📊 Data Requirements

The system expects an Excel (`.xlsx`) or CSV file with the following schema:

| Column | Description |
|---|---|
| `CustomerID` | Unique ID for each customer |
| `InvoiceNo` | Transaction ID (Starts with 'C' for cancellations) |
| `InvoiceDate` | Timestamp of the transaction |
| `StockCode` | Product SKU/ID |
| `Description` | Product name |
| `Quantity` | Number of units sold |
| `UnitPrice` | Price per unit |

---

## 🎯 Use Cases
- **Targeted Marketing**: Send personalized offers to "At Risk" customers to prevent churn.
- **Inventory Optimization**: Prioritize stock for "Top Products" identified by the dashboard.
- **Cross-Selling**: Use the recommendation engine to suggest bundles at checkout.
- **Financial Planning**: Analyze monthly revenue trends for better forecasting.

---
*Developed for Retail Data Excellence.*
