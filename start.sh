#!/bin/bash

# Start both Daphne (ASGI server) and Celery worker in the background
# This script is for Render deployment

export PYTHONUNBUFFERED=1

echo "Starting Daphne ASGI server..."
daphne -b 0.0.0.0 -p $PORT Backend.asgi:application &
DAPHNE_PID=$!

echo "Starting Celery worker..."
celery -A Backend worker -l info --pool=threads --concurrency=2 &
CELERY_PID=$!

# Function to handle shutdown
shutdown() {
    echo "Shutting down..."
    kill $DAPHNE_PID 2>/dev/null
    kill $CELERY_PID 2>/dev/null
    wait
    exit 0
}

# Trap signals
trap shutdown SIGTERM SIGINT

# Wait for both processes
wait $DAPHNE_PID $CELERY_PID
