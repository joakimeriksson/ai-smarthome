const graphData = {
  nodes: [
    { data: { 
        id: 'robotics', 
        label: 'Humanoid\nRobotics',
        description: "Advanced robotics systems with human-like capabilities. Focus on natural interaction and movement.",
        image: 'imgs/bot-svgrepo-com.svg'
      }, 
      classes: 'top-right' 
    },
    { data: { 
        id: 'tools', 
        label: 'Open Source\nTools and Tech',
        description: "Community-driven development tools and frameworks. Supporting collaborative tech innovation.",
        image: 'imgs/server-svgrepo-com.svg'
      }, 
      classes: 'top-right' 
    },
    { data: { 
        id: 'edgeai', 
        label: 'AI on the \nEdge',
        description: "Intelligent processing at device level. Reducing latency and cloud dependency.",
        image: 'imgs/computer-chip-svgrepo-com-2.svg'
      }, 
      classes: 'top-right' 
    },
    { data: { 
        id: 'edge', 
        label: 'Edge\nComputing',
        description: "Distributed computing architecture. Processing data closer to the source.",
        image: 'imgs/computer-chip-svgrepo-com.svg'
      }, 
      classes: 'top-right' 
    },
    { data: { 
        id: 'sustainable', 
        label: 'Sustainable\nWorld',
        description: "Environmental technology solutions. Creating eco-friendly tech ecosystems.",
        image: 'imgs/tabler-icon-topology-star-3.svg'
      }, 
      classes: 'top-right' 
    },
    { data: { 
        id: 'csw', 
        label: 'Connected \nSustainable World',
        description: "Integrated sustainable technologies. Building smart, efficient futures.",
        image: null
      }, 
      classes: 'center' 
    },
    { data: { 
        id: 'llm', 
        label: 'Large Language\nModels',
        description: "Advanced AI language processing. Natural language understanding and generation.",
        image: 'imgs/wrench-screwdriver-tool-options-svgrepo-com.svg'
      }, 
      classes: 'top-right' 
    },
    { data: { 
        id: 'cloud', 
        label: 'Cloud\nServices',
        description: "Scalable cloud infrastructure. Flexible computing resources on demand.",
        image: 'imgs/server-cloud-svgrepo-com.svg'
      }, 
      classes: 'top-right' 
    },
    { data: { 
      id: 'sensors', 
      label: 'Smart\nSensors',
      description: "Advanced IoT sensing technologies. Enabling real-time environmental and system monitoring.",
      image: 'imgs/sensor-svgrepo-com.svg'
    }, 
    classes: 'top-right' 
    },
    { data: { 
      id: 'harvest', 
      label: 'Energy\nHarvesting',
      description: "Ambient energy collection systems. Converting environmental energy into usable power.",
      image: 'imgs/solar-energy-svgrepo-com.svg'
    }, 
    classes: 'top-right' 
    },
    { data: { 
      id: 'lowpower', 
      label: 'Ultra-Low\nPower Computing',
      description: "Minimal energy consumption processors. Optimized for maximum efficiency operations.",
      image: 'imgs/microchip-svgrepo-com.svg'
    }, 
    classes: 'top-right' 
    },
    { data: { 
      id: 'intermittent', 
      label: 'Intermittent\nComputing',
      description: "Computing systems that operate with unreliable power. Maintaining progress despite frequent power interruptions.",
      image: 'imgs/battery-half-fill-1471-svgrepo-com.svg'
    }, 
    classes: 'top-right' 
    },
    { data: { 
      id: 'mesh', 
      label: 'Mesh\nNetworking',
      description: "Self-organizing device networks. Enabling resilient and efficient data communication.",
      image: 'imgs/network-white-svgrepo-com.svg'
    }, 
    classes: 'top-right' 
    },
    { data: { 
      id: 'zeroIoT', 
      label: 'Zero Energy\nIoT',
      description: "Self-sustaining Internet of Things devices. Operating perpetually without external power sources.",
    }, 
    classes: 'center' 
    }
  ],
  edges: [
    { data: { source: 'robotics', target: 'tools' } },
    { data: { source: 'tools', target: 'edgeai' } },
    { data: { source: 'tools', target: 'llm' } },
    { data: { source: 'llm', target: 'cloud' } },
    { data: { source: 'edgeai', target: 'edge' } },
    { data: { source: 'edge', target: 'sustainable' } },
    { data: { source: 'sustainable', target: 'csw' } },
    { data: { source: 'sensors', target: 'harvest' } },
    { data: { source: 'harvest', target: 'lowpower' } },
    { data: { source: 'lowpower', target: 'intermittent' } },
    { data: { source: 'intermittent', target: 'mesh' } },
    { data: { source: 'mesh', target: 'zeroIoT' } }
  ]
};
