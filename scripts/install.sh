#!/bin/bash
# Nenopix Studio CLI — Unix/Mac Global Install Script
# Run: bash scripts/install.sh

set -e

echo ""
echo "  ⚡ Nenopix Studio CLI — Install Script"
echo "  ───────────────────────────────────────"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  ✗ Node.js not found. Install from: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "  ✓ Node.js $NODE_VERSION found"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "  ✗ npm not found"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo "  ✓ npm v$NPM_VERSION found"
echo ""

echo "  Installing dependencies..."
npm install

echo ""
echo "  Building TypeScript..."
npm run build

echo ""
echo "  Linking globally..."
npm link

echo ""
echo "  ✓ Nenopix Studio CLI installed!"
echo ""

# Check if setup has configured providers
echo "  Verifying API key configuration..."
STATUS_JSON=$(node dist/cli/index.js status --json 2>/dev/null || echo "")

if [ -n "$STATUS_JSON" ]; then
    CONFIGURED_COUNT=$(echo "$STATUS_JSON" | node -e "
        try {
            const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
            console.log(data.configuredCount || 0);
        } catch(e) { console.log(0); }
    ")
    
    if [ "$CONFIGURED_COUNT" -gt 0 ]; then
        echo "  ✓ Found $CONFIGURED_COUNT configured provider(s)"
        
        # Get default provider
        DEFAULT_PROVIDER=$(echo "$STATUS_JSON" | node -e "
            try {
                const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
                console.log(data.config.defaultProvider || 'gemini');
            } catch(e) { console.log('gemini'); }
        ")
        
        echo "  Testing connection for default provider '$DEFAULT_PROVIDER'..."
        TEST_RESULT=$(node dist/cli/index.js providers test "$DEFAULT_PROVIDER" 2>/dev/null || echo "")
        if [[ "$TEST_RESULT" == *"✓"* ]]; then
            echo "  ✓ API key verified and working successfully!"
        else
            echo "  ⚠ Connection test failed. You might need to update your API key."
            echo "  $TEST_RESULT"
        fi
    else
        echo "  ⚠ No configured providers found."
        echo "  To generate images, Nenopix Studio needs at least one API key."
        echo "  Supported env variables: NENOPIX_GEMINI_API_KEY, NENOPIX_OPENAI_API_KEY"
        echo ""
        
        # Check if running interactively
        if [ -t 0 ]; then
            read -p "  Would you like to run the setup wizard now? [Y/n]: " choice
            if [[ "$choice" != "n" && "$choice" != "N" ]]; then
                node dist/cli/index.js config --setup
            else
                echo "  You can run the setup wizard later with: nenopix config --setup"
            fi
        else
            echo "  Non-interactive mode: skipping wizard. Run 'nenopix config --setup' to configure."
        fi
    fi
else
    echo "  ⚠ Could not read system status."
fi

echo ""
echo "  Starting Nenopix Studio Web UI..."
echo "  This will start the server and open the browser."
echo "  Press Ctrl+C to stop the server."
echo ""
node dist/cli/index.js ui
