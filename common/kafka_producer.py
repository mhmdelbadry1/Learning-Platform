import os
import json
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

# Try to create producer, but make it optional
try:
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS.split(','),
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )
    KAFKA_AVAILABLE = True
    print(f"✓ Kafka connected: {KAFKA_BOOTSTRAP_SERVERS}")
except NoBrokersAvailable:
    producer = None
    KAFKA_AVAILABLE = False
    print(f"⚠ Kafka unavailable, events will not be published")
except Exception as e:
    producer = None
    KAFKA_AVAILABLE = False
    print(f"⚠ Kafka error: {e}")

def send_event(topic: str, event_data: dict):
    """Send event to Kafka if available, otherwise just log it"""
    if KAFKA_AVAILABLE and producer:
        try:
            producer.send(topic, event_data)
            producer.flush()
        except Exception as e:
            print(f"Kafka publish error: {e}")
    else:
        print(f"[KAFKA DISABLED] Would publish to {topic}: {event_data}")