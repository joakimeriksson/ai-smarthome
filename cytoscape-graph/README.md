# Technology Journey Visualization

This project is an interactive visualization of a technology journey, built with Cytoscape.js. It displays technology goals as a directed graph, showing the stepping stones required to reach a final objective.

## Features

*   **Interactive Graph:** View technology nodes and their connections.
*   **Node Descriptions:** Hover over a node to see a description.
*   **In-Browser Editor:** Add, and soon, edit/delete nodes and edges directly in the browser.
*   **Dynamic Image Loading:** Images for nodes are dynamically loaded from the `imgs` directory.

## Setup and Running

This project uses a Python backend with Flask and is managed with `uv`.

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd <your-repo-directory>
    ```

2.  **Run the server:**
    ```bash
    uv run python server.py
    ```

3.  **Open in your browser:**
    Navigate to `http://127.0.0.1:5000` in your web browser.

## Editing the Graph

Click the "Edit Graph" button to open the editor. Here you can add new nodes and edges. When you are done, you can either save the changes to the current view or export the data as a new `data.js` file.