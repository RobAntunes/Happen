#!/bin/bash

# Simple test runner for Happen examples across environments

# Exit immediately if a command exits with a non-zero status.
set -e

BASE_DIR=$(pwd)
# Point to the build output directory
BUILD_DIR="${BASE_DIR}/dist"
EXAMPLES_SRC_DIR="${BASE_DIR}/examples"
EXAMPLES_DIST_DIR="${BUILD_DIR}/examples"
BROWSER_EXAMPLE_DIST_DIR="${EXAMPLES_DIST_DIR}/browser-basic"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# --- Helper Functions ---

run_test() {
    local test_name="$1"
    local command="$2"
    local log_file="/tmp/happen_test_${test_name}.log"

    echo -e "\n${YELLOW}Running Test: ${test_name}...${NC}"
    echo "Command: ${command}"
    # Use eval to handle potential quoting issues if paths have spaces
    eval ${command} > >(tee "${log_file}") 2> >(tee "${log_file}" >&2)
    local exit_code=$?

    if [ $exit_code -ne 0 ]; then
        echo -e "${RED}TEST FAILED: ${test_name} (Exit Code: ${exit_code})${NC}"
        echo "Logs: ${log_file}"
        return 1
    fi

    if grep -q "TEST_RESULT: FAIL" "${log_file}"; then
        echo -e "${RED}TEST FAILED: ${test_name} (FAIL marker found)${NC}"
        echo "Logs: ${log_file}"
        return 1
    fi

    if grep -q "TEST_RESULT: PASS" "${log_file}"; then
        echo -e "${GREEN}TEST PASSED: ${test_name}${NC}"
        return 0
    else
         echo -e "${RED}TEST FAILED: ${test_name} (PASS marker not found)${NC}"
         echo "Logs: ${log_file}"
         return 1
    fi
}

# --- Main Execution ---

overall_status=0

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo >&2 "node not found. Aborting."; exit 1; }
command -v deno >/dev/null 2>&1 || { echo >&2 "deno not found. Aborting."; exit 1; }
command -v bun >/dev/null 2>&1 || { echo >&2 "bun not found. Aborting."; exit 1; }

# 0. Run the build first to ensure dist is up-to-date
echo -e "${YELLOW}Ensuring project is built...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed. Cannot run tests.${NC}"
    exit 1
fi
echo -e "${GREEN}Build successful.${NC}"

# DEBUG: Show the content of a generated file after postbuild
echo -e "\n${YELLOW}--- Content of dist/examples/node-basic.js after build ---${NC}"
cat "${EXAMPLES_DIST_DIR}/node-basic.js" || echo -e "${RED}Failed to cat file.${NC}"
echo -e "${YELLOW}----------------------------------------------------------${NC}\n"

# 1. Node.js Basic Example (run .js file from dist)
run_test "node-basic" "node ${EXAMPLES_DIST_DIR}/node-basic.js" || overall_status=1

# 2. Node.js Chained Example (run .js file from dist)
run_test "node-chained" "node ${EXAMPLES_DIST_DIR}/node-chained-events.js" || overall_status=1

# 3. Node.js Hooks Example (run .js file from dist)
run_test "node-hooks" "node ${EXAMPLES_DIST_DIR}/hook-showcase.js" || overall_status=1

# 4. Deno Basic Example (run .js file from dist, needs allow-read for potential relative imports within dist)
run_test "deno-basic" "deno run --allow-read --allow-env --allow-net ${EXAMPLES_DIST_DIR}/deno-basic.js" || overall_status=1

# 5. Bun Basic Example (run .js file from dist)
run_test "bun-basic" "bun run ${EXAMPLES_DIST_DIR}/bun-basic.js" || overall_status=1

# 6. Browser Example (Build step is already done by npm run build, just show message)
echo -e "\n${YELLOW}Browser Test Setup:${NC}"
echo "Build successful (done during initial build): ${BROWSER_EXAMPLE_DIST_DIR}/main.js"
echo -e "${YELLOW}MANUAL ACTION REQUIRED:${NC}"
echo "1. Start a simple HTTP server in the workspace root (e.g., python -m http.server 8000 or npx serve .)."
echo "2. Open two browser tabs to: http://localhost:8000/dist/examples/browser-basic/index.html" # Point to dist
echo "3. Follow instructions on the page (Init Node A, Init Node B, Emit Ping)."
echo "4. Check the log output in the browser tabs for 'TEST_RESULT: PASS'."

# --- Final Result ---

echo -e "\n${YELLOW}--- Test Summary ---${NC}"
if [ $overall_status -eq 0 ]; then
    echo -e "${GREEN}All automated tests passed!${NC}"
    echo "(Remember to manually verify the browser test)"
    exit 0
else
    echo -e "${RED}One or more tests failed.${NC}"
    exit 1
fi
